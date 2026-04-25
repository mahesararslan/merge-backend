import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import {
  lemonSqueezySetup,
  createCheckout,
  cancelSubscription as lsCancelSubscription,
  getSubscription,
} from '@lemonsqueezy/lemonsqueezy.js';
import { ConfigService } from '@nestjs/config';
import { SubscriptionPlan, PlanTier } from '../entities/subscription-plan.entity';
import { UserSubscription, SubscriptionStatus } from '../entities/user-subscription.entity';
import { PaymentRecord, PaymentStatus } from '../entities/payment-record.entity';
import { UserBadge } from '../entities/user-badge.entity';
import { User } from '../entities/user.entity';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectRepository(SubscriptionPlan)
    private planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(UserSubscription)
    private subscriptionRepo: Repository<UserSubscription>,
    @InjectRepository(PaymentRecord)
    private paymentRepo: Repository<PaymentRecord>,
    @InjectRepository(UserBadge)
    private userBadgeRepo: Repository<UserBadge>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private configService: ConfigService,
    private notificationService: NotificationService,
  ) {}

  private setupLs() {
    lemonSqueezySetup({
      apiKey: this.configService.get<string>('LEMON_SQUEEZY_API_KEY'),
    });
  }

  async getPlans(): Promise<SubscriptionPlan[]> {
    return this.planRepo.find({ where: { isActive: true }, order: { priceMonthly: 'ASC' } });
  }

  async getUserSubscription(userId: string) {
    const sub = await this.subscriptionRepo.findOne({
      where: { user: { id: userId } },
      relations: ['plan'],
    });
    if (sub) return sub;

    // Return a virtual free-plan object for users with no subscription record
    const freePlan = await this.planRepo.findOne({ where: { name: PlanTier.FREE } });
    return {
      id: null,
      plan: freePlan,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      appliedDiscountPercentage: 0,
    };
  }

  async createCheckoutSession(userId: string, planId: string): Promise<{ checkoutUrl: string }> {
    this.setupLs();

    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    if (!plan.lsVariantId) {
      throw new BadRequestException(
        'Payment is not configured for this plan yet. To enable payments: (1) Create a LemonSqueezy account at app.lemonsqueezy.com, (2) Create a product for this plan, (3) Copy the Variant ID and add it to your backend .env as LEMON_SQUEEZY_PRO_VARIANT_ID etc., then restart the backend.',
      );
    }

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Find best unspent badge discount
    const badges = await this.userBadgeRepo.find({
      where: { user: { id: userId }, isRedeemed: false },
      relations: ['badge'],
      order: { createdAt: 'DESC' },
    });
    const bestBadge = badges.sort((a, b) => b.badge.discountPercentage - a.badge.discountPercentage)[0];

    const frontendUrl = this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';
    const storeId = this.configService.get<string>('LEMON_SQUEEZY_STORE_ID') ?? '';

    const checkoutData: Parameters<typeof createCheckout>[2] = {
      checkoutOptions: {
        embed: false,
      },
      checkoutData: {
        email: user.email,
        name: `${user.firstName} ${user.lastName}`,
        custom: { userId },
        discountCode: bestBadge?.lsDiscountCode ?? undefined,
      },
      productOptions: {
        redirectUrl: `${frontendUrl}/billing?success=true`,
        receiptButtonText: 'Go to Billing',
      },
    };

    const { data, error } = await createCheckout(storeId, plan.lsVariantId, checkoutData);

    if (error) {
      this.logger.error(`LemonSqueezy checkout error: ${JSON.stringify(error)}`);
      throw new Error('Failed to create checkout session');
    }

    return { checkoutUrl: data.data.attributes.url };
  }

  async cancelUserSubscription(userId: string): Promise<void> {
    this.setupLs();
    const sub = await this.subscriptionRepo.findOne({ where: { user: { id: userId } } });
    if (!sub || !sub.lsSubscriptionId) throw new NotFoundException('No active subscription');

    await lsCancelSubscription(sub.lsSubscriptionId);
    sub.cancelAtPeriodEnd = true;
    await this.subscriptionRepo.save(sub);
  }

  async getPaymentHistory(userId: string, page = 1, limit = 10) {
    const [data, total] = await this.paymentRepo.findAndCount({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const secret = this.configService.get<string>('LEMON_SQUEEZY_WEBHOOK_SECRET') ?? '';
    const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    if (digest !== signature) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody.toString());
    const eventName: string = payload?.meta?.event_name;
    const attrs = payload?.data?.attributes ?? {};
    const customData = payload?.meta?.custom_data ?? {};
    const userId: string | undefined = customData?.userId;

    this.logger.log(`Webhook received: ${eventName}`);

    switch (eventName) {
      case 'subscription_created':
      case 'subscription_updated':
        await this.upsertSubscription(userId, attrs, payload.data.id);
        break;

      case 'subscription_cancelled':
        await this.handleCancelled(payload.data.id);
        break;

      case 'subscription_expired':
        await this.handleExpired(payload.data.id);
        break;

      case 'order_created':
        await this.handleOrderCreated(userId, attrs, payload.data.id);
        break;

      case 'subscription_payment_failed':
        await this.handlePaymentFailed(payload.data.id, userId);
        break;

      default:
        this.logger.log(`Unhandled webhook event: ${eventName}`);
    }
  }

  // ─── Webhook handlers ──────────────────────────────────────────────────────

  private async upsertSubscription(userId: string | undefined, attrs: any, lsSubId: string): Promise<void> {
    if (!userId) return;

    const variantId = String(attrs.variant_id);
    const plan = await this.planRepo.findOne({ where: { lsVariantId: variantId } });
    if (!plan) {
      this.logger.warn(`No plan found for variant ${variantId}`);
      return;
    }

    let sub = await this.subscriptionRepo.findOne({ where: { lsSubscriptionId: lsSubId } })
      ?? await this.subscriptionRepo.findOne({ where: { user: { id: userId } } });

    if (!sub) {
      sub = this.subscriptionRepo.create({ user: { id: userId } as User });
    }

    sub.plan = plan;
    sub.lsSubscriptionId = lsSubId;
    sub.lsCustomerId = String(attrs.customer_id ?? '');
    sub.status = this.mapLsStatus(attrs.status);
    sub.currentPeriodStart = attrs.renews_at ? new Date(attrs.created_at) : null;
    sub.currentPeriodEnd = attrs.renews_at ? new Date(attrs.renews_at) : null;
    sub.cancelAtPeriodEnd = attrs.cancelled ?? false;
    await this.subscriptionRepo.save(sub);

    // Update user tier
    await this.userRepo.update({ id: userId }, { subscriptionTier: plan.name });
  }

  private async handleCancelled(lsSubId: string): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({ where: { lsSubscriptionId: lsSubId } });
    if (!sub) return;
    sub.cancelAtPeriodEnd = true;
    await this.subscriptionRepo.save(sub);
  }

  private async handleExpired(lsSubId: string): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({
      where: { lsSubscriptionId: lsSubId },
      relations: ['user'],
    });
    if (!sub) return;
    sub.status = SubscriptionStatus.EXPIRED;
    await this.subscriptionRepo.save(sub);
    await this.userRepo.update({ id: sub.user.id }, { subscriptionTier: PlanTier.FREE });
    await this.notificationService.sendNotificationToUser(
      sub.user.id,
      'Your subscription has expired. Upgrade to continue enjoying premium features.',
      { type: 'subscription-expired', actionUrl: '/billing' },
    );
  }

  private async handleOrderCreated(userId: string | undefined, attrs: any, lsOrderId: string): Promise<void> {
    if (!userId) return;
    const sub = await this.subscriptionRepo.findOne({ where: { user: { id: userId } } });
    const record = this.paymentRepo.create({
      user: { id: userId } as User,
      subscription: sub ?? undefined,
      amountPkr: Number(attrs.total ?? 0) / 100,
      status: PaymentStatus.PAID,
      lsOrderId,
      invoiceUrl: attrs.urls?.receipt ?? null,
      paidAt: new Date(),
    });
    await this.paymentRepo.save(record);

    // Mark badge discount as redeemed if applied
    const discountCode = attrs.discount_code;
    if (discountCode) {
      await this.userBadgeRepo.update(
        { lsDiscountCode: discountCode, user: { id: userId } },
        { isRedeemed: true },
      );
    }
  }

  private async handlePaymentFailed(lsSubId: string, userId: string | undefined): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({ where: { lsSubscriptionId: lsSubId } });
    if (sub) {
      sub.status = SubscriptionStatus.PAST_DUE;
      await this.subscriptionRepo.save(sub);
    }
    if (userId) {
      await this.notificationService.sendNotificationToUser(
        userId,
        'Payment failed for your subscription. Please update your payment method.',
        { type: 'payment-failed', actionUrl: '/billing' },
      );
    }
  }

  private mapLsStatus(lsStatus: string): SubscriptionStatus {
    switch (lsStatus) {
      case 'active': return SubscriptionStatus.ACTIVE;
      case 'cancelled': return SubscriptionStatus.CANCELLED;
      case 'expired': return SubscriptionStatus.EXPIRED;
      case 'past_due': return SubscriptionStatus.PAST_DUE;
      case 'on_trial': return SubscriptionStatus.TRIALING;
      default: return SubscriptionStatus.ACTIVE;
    }
  }
}
