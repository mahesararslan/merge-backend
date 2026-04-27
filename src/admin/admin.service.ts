import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, ILike, IsNull, Not, In } from 'typeorm';
import { User, UserRole } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { RoomMember } from '../entities/room-member.entity';
import { LiveSession } from '../entities/live-video-session.entity';
import { SubscriptionPlan, PlanTier } from '../entities/subscription-plan.entity';
import { UserSubscription, SubscriptionStatus } from '../entities/user-subscription.entity';
import { PaymentRecord } from '../entities/payment-record.entity';
import { Badge } from '../entities/badge.entity';
import { UserBadge } from '../entities/user-badge.entity';
import { ChallengeDefinition, ChallengeType, ChallengeAction } from '../entities/challenge-definition.entity';
import { UserStreak } from '../entities/user-streak.entity';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectRepository(User)              private userRepo: Repository<User>,
    @InjectRepository(Room)              private roomRepo: Repository<Room>,
    @InjectRepository(RoomMember)        private memberRepo: Repository<RoomMember>,
    @InjectRepository(LiveSession)       private sessionRepo: Repository<LiveSession>,
    @InjectRepository(SubscriptionPlan)  private planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(UserSubscription)  private subRepo: Repository<UserSubscription>,
    @InjectRepository(PaymentRecord)     private paymentRepo: Repository<PaymentRecord>,
    @InjectRepository(Badge)             private badgeRepo: Repository<Badge>,
    @InjectRepository(UserBadge)         private userBadgeRepo: Repository<UserBadge>,
    @InjectRepository(ChallengeDefinition) private challengeRepo: Repository<ChallengeDefinition>,
    @InjectRepository(UserStreak)        private streakRepo: Repository<UserStreak>,
    private readonly notificationService: NotificationService,
  ) {}

  // ─── Phase 1.1 — Overview ─────────────────────────────────────────────────

  async getOverview() {
    const [totalUsers, totalRooms] = await Promise.all([
      this.userRepo.count(),
      this.roomRepo.count(),
    ]);

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dau = await this.streakRepo.count({
      where: { lastActivityDate: Between(oneDayAgo as any, new Date() as any) },
    });

    const activeLiveSessions = await this.sessionRepo
      .createQueryBuilder('s')
      .where("s.status = 'live'")
      .getCount();

    // MRR — sum of plan prices for all currently-active or trialing subscriptions
    const activeSubs = await this.subRepo.find({
      where: [{ status: SubscriptionStatus.ACTIVE }, { status: SubscriptionStatus.TRIALING }],
      relations: ['plan'],
    });
    const mrrPkr = activeSubs.reduce((acc, s) => acc + Number(s.plan?.priceMonthly ?? 0), 0);

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const badgesEarnedThisMonth = await this.userBadgeRepo
      .createQueryBuilder('ub')
      .where('ub.period_month = :pm', { pm: monthStart.toISOString().slice(0, 10) })
      .getCount();

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const failedPaymentsLast7d = await this.paymentRepo
      .createQueryBuilder('p')
      .where("p.status = 'failed'")
      .andWhere('p."createdAt" >= :d', { d: sevenDaysAgo })
      .getCount();

    const recentSignups = await this.userRepo.find({
      order: { createdAt: 'DESC' },
      take: 10,
      select: ['id', 'firstName', 'lastName', 'email', 'createdAt', 'subscriptionTier'],
    });

    const recentPayments = await this.paymentRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.user', 'user')
      .leftJoinAndSelect('p.subscription', 'sub')
      .leftJoinAndSelect('sub.plan', 'plan')
      .orderBy('p."createdAt"', 'DESC')
      .take(10)
      .getMany();

    return {
      totalUsers,
      dau,
      totalRooms,
      activeLiveSessions,
      mrrPkr,
      badgesEarnedThisMonth,
      failedPaymentsLast7d,
      recentSignups,
      recentPayments: recentPayments.map((p) => ({
        id: p.id,
        amountPkr: Number(p.amountPkr),
        status: p.status,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        userName: p.user ? `${p.user.firstName} ${p.user.lastName}` : null,
        userEmail: p.user?.email,
        planName: p.subscription?.plan?.displayName ?? null,
      })),
    };
  }

  // ─── Phase 1.2 — Users ────────────────────────────────────────────────────

  async listUsers(opts: {
    page?: number; limit?: number; role?: UserRole; tier?: PlanTier; search?: string;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const qb = this.userRepo.createQueryBuilder('u');
    if (opts.role) qb.andWhere('u.role = :role', { role: opts.role });
    if (opts.tier) qb.andWhere('u."subscriptionTier" = :tier', { tier: opts.tier });
    if (opts.search) {
      qb.andWhere('(u.email ILIKE :s OR u."firstName" ILIKE :s OR u."lastName" ILIKE :s)', {
        s: `%${opts.search}%`,
      });
    }
    qb.orderBy('u."createdAt"', 'DESC').skip((page - 1) * limit).take(limit);
    const [users, total] = await qb.getManyAndCount();
    return {
      users: users.map((u) => this.mapUser(u)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserDetail(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const [subscription, ownedRooms, badgesCount, paymentsCount] = await Promise.all([
      this.subRepo.findOne({ where: { user: { id: userId } }, relations: ['plan'] }),
      this.memberRepo.count({ where: { user: { id: userId } } }),
      this.userBadgeRepo.count({ where: { user: { id: userId } } }),
      this.paymentRepo.count({ where: { user: { id: userId } } }),
    ]);

    return {
      ...this.mapUser(user),
      subscription: subscription ? {
        status: subscription.status,
        planName: subscription.plan?.displayName,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      } : null,
      stats: { ownedRooms, badgesCount, paymentsCount },
    };
  }

  async updateUserRole(userId: string, role: UserRole) {
    if (!Object.values(UserRole).includes(role)) throw new BadRequestException('Invalid role');
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.role = role;
    await this.userRepo.save(user);
    return this.mapUser(user);
  }

  async setUserSuspension(userId: string, suspend: boolean, reason?: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.suspendedAt = suspend ? new Date() : null;
    user.suspendedReason = suspend ? (reason ?? 'Suspended by admin') : null;
    await this.userRepo.save(user);
    return this.mapUser(user);
  }

  private mapUser(u: User) {
    return {
      id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName,
      image: u.image, role: u.role, subscriptionTier: u.subscriptionTier,
      googleAccount: u.googleAccount,
      suspendedAt: u.suspendedAt, suspendedReason: u.suspendedReason,
      createdAt: u.createdAt, updatedAt: u.updatedAt,
    };
  }

  // ─── Phase 1.3 — Billing ──────────────────────────────────────────────────

  async listPayments(opts: {
    page?: number; limit?: number; status?: string; planTier?: PlanTier; from?: string; to?: string;
  }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const qb = this.paymentRepo.createQueryBuilder('p')
      .leftJoinAndSelect('p.user', 'user')
      .leftJoinAndSelect('p.subscription', 'sub')
      .leftJoinAndSelect('sub.plan', 'plan');
    if (opts.status) qb.andWhere('p.status = :s', { s: opts.status });
    if (opts.planTier) qb.andWhere('plan.name = :pt', { pt: opts.planTier });
    if (opts.from) qb.andWhere('p."createdAt" >= :from', { from: opts.from });
    if (opts.to) qb.andWhere('p."createdAt" <= :to', { to: opts.to });
    qb.orderBy('p."createdAt"', 'DESC').skip((page - 1) * limit).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return {
      payments: rows.map((p) => ({
        id: p.id,
        amountPkr: Number(p.amountPkr),
        status: p.status,
        lsOrderId: p.lsOrderId,
        invoiceUrl: p.invoiceUrl,
        paidAt: p.paidAt,
        createdAt: p.createdAt,
        user: p.user ? { id: p.user.id, email: p.user.email, firstName: p.user.firstName, lastName: p.user.lastName } : null,
        plan: p.subscription?.plan ? { name: p.subscription.plan.name, displayName: p.subscription.plan.displayName } : null,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  async getRevenueSeries(daysBack: number = 30) {
    const start = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    start.setUTCHours(0, 0, 0, 0);
    const rows = await this.paymentRepo
      .createQueryBuilder('p')
      .select(`DATE_TRUNC('day', p."createdAt")`, 'day')
      .addSelect('SUM(p."amountPkr")', 'total')
      .where('p.status = :s', { s: 'paid' })
      .andWhere('p."createdAt" >= :start', { start })
      .groupBy(`DATE_TRUNC('day', p."createdAt")`)
      .orderBy('day', 'ASC')
      .getRawMany();
    return rows.map((r) => ({
      day: new Date(r.day).toISOString().slice(0, 10),
      total: Number(r.total ?? 0),
    }));
  }

  async getSubscriptionsSummary() {
    const counts = await this.subRepo
      .createQueryBuilder('s')
      .select('s.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('s.status')
      .getRawMany();
    const map: Record<string, number> = {};
    for (const c of counts) map[c.status] = Number(c.count);
    return {
      active: map['active'] ?? 0,
      trialing: map['trialing'] ?? 0,
      cancelled: map['cancelled'] ?? 0,
      expired: map['expired'] ?? 0,
      past_due: map['past_due'] ?? 0,
    };
  }

  // ─── Phase 1.4 — Rewards CRUD ────────────────────────────────────────────

  listChallenges() {
    return this.challengeRepo.find({ order: { periodStart: 'DESC', name: 'ASC' } });
  }

  async createChallenge(dto: any) {
    if (!dto.name || !dto.description || !dto.tier || !dto.actionType || !dto.target || !dto.periodStart) {
      throw new BadRequestException('Missing required fields (name, description, tier, actionType, target, periodStart)');
    }
    const { periodStart, periodEnd } = this.computePeriod(dto.tier, dto.periodStart);
    const row = this.challengeRepo.create({
      name: dto.name,
      description: dto.description,
      icon: this.defaultIconForTier(dto.tier),
      tier: dto.tier,
      actionType: dto.actionType,
      target: Number(dto.target),
      points: Number(dto.points ?? 10),
      minPlanTier: dto.minPlanTier ?? PlanTier.FREE,
      periodStart,
      periodEnd,
      isActive: dto.isActive ?? true,
    });
    return this.challengeRepo.save(row);
  }

  async updateChallenge(id: string, dto: any) {
    const row = await this.challengeRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Challenge not found');

    // If periodStart is supplied, recompute periodEnd from the (possibly new) tier
    let periodStart: Date | null | undefined = undefined;
    let periodEnd: Date | null | undefined = undefined;
    if (dto.periodStart != null) {
      const tierForPeriod = dto.tier ?? row.tier;
      const computed = this.computePeriod(tierForPeriod, dto.periodStart);
      periodStart = computed.periodStart;
      periodEnd = computed.periodEnd;
    }

    Object.assign(row, {
      name: dto.name ?? row.name,
      description: dto.description ?? row.description,
      tier: dto.tier ?? row.tier,
      actionType: dto.actionType ?? row.actionType,
      target: dto.target != null ? Number(dto.target) : row.target,
      points: dto.points != null ? Number(dto.points) : row.points,
      minPlanTier: dto.minPlanTier ?? row.minPlanTier,
      isActive: dto.isActive ?? row.isActive,
      ...(periodStart !== undefined ? { periodStart } : {}),
      ...(periodEnd !== undefined ? { periodEnd } : {}),
      // Sync icon to tier if tier changed (we don't ask admin for icons).
      icon: dto.tier && dto.tier !== row.tier ? this.defaultIconForTier(dto.tier) : row.icon,
    });
    return this.challengeRepo.save(row);
  }

  /**
   * Convert the admin-supplied date input into a [periodStart, periodEnd) window,
   * snapped to tier boundaries (UTC):
   *   - daily   → that calendar day, ends next day
   *   - weekly  → Monday of that week, ends following Monday (+7 days)
   *   - monthly → 1st of that month, ends 1st of next month
   * Accepts either a YYYY-MM-DD or YYYY-MM string.
   */
  private computePeriod(tier: string, input: string): { periodStart: Date; periodEnd: Date } {
    // Parse without local-tz drift. "YYYY-MM" → assume day 01.
    const parts = (input.includes('-') ? input.split('-') : []).map((p) => Number(p));
    const [y, m, d] = [parts[0], parts[1], parts[2] ?? 1];
    if (!y || !m) throw new BadRequestException('Invalid periodStart date');

    if (tier === 'daily') {
      const start = new Date(Date.UTC(y, m - 1, d));
      const end = new Date(Date.UTC(y, m - 1, d + 1));
      return { periodStart: start, periodEnd: end };
    }
    if (tier === 'weekly') {
      const dt = new Date(Date.UTC(y, m - 1, d));
      const day = dt.getUTCDay(); // 0=Sun
      const diff = day === 0 ? -6 : 1 - day; // snap to Monday
      const start = new Date(Date.UTC(y, m - 1, d + diff));
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 7);
      return { periodStart: start, periodEnd: end };
    }
    // monthly
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    return { periodStart: start, periodEnd: end };
  }

  private defaultIconForTier(tier: string): string {
    if (tier === 'daily') return 'check-circle';
    if (tier === 'weekly') return 'target';
    return 'star'; // monthly
  }

  async deleteChallenge(id: string) {
    const result = await this.challengeRepo.delete({ id });
    if (result.affected === 0) throw new NotFoundException('Challenge not found');
    return { id };
  }

  listBadges() {
    return this.badgeRepo.find({ order: { tier: 'ASC' } });
  }

  async updateBadge(id: string, dto: any) {
    const row = await this.badgeRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Badge not found');
    Object.assign(row, {
      name: dto.name ?? row.name,
      description: dto.description ?? row.description,
      icon: dto.icon ?? row.icon,
      discountPercentage: dto.discountPercentage != null ? Number(dto.discountPercentage) : row.discountPercentage,
      isActive: dto.isActive ?? row.isActive,
    });
    return this.badgeRepo.save(row);
  }

  async listAwardedBadges(opts: { page?: number; limit?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const qb = this.userBadgeRepo.createQueryBuilder('ub')
      .leftJoinAndSelect('ub.user', 'user')
      .leftJoinAndSelect('ub.badge', 'badge')
      .orderBy('ub."earnedAt"', 'DESC')
      .skip((page - 1) * limit).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return {
      awarded: rows.map((r) => ({
        id: r.id,
        earnedAt: r.earnedAt,
        periodMonth: r.periodMonth,
        isRedeemed: r.isRedeemed,
        lsDiscountCode: r.lsDiscountCode,
        badge: { id: r.badge.id, name: r.badge.name, tier: r.badge.tier, discountPercentage: r.badge.discountPercentage },
        user: r.user ? { id: r.user.id, email: r.user.email, firstName: r.user.firstName, lastName: r.user.lastName } : null,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  // ─── Phase 2.1 — Rooms ───────────────────────────────────────────────────

  async listRooms(opts: { page?: number; limit?: number; search?: string }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const qb = this.roomRepo.createQueryBuilder('r')
      .leftJoinAndSelect('r.admin', 'admin')
      .loadRelationCountAndMap('r.memberCount', 'r.members');
    if (opts.search) qb.andWhere('(r.title ILIKE :s OR r.description ILIKE :s)', { s: `%${opts.search}%` });
    qb.orderBy('r."createdAt"', 'DESC').skip((page - 1) * limit).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return {
      rooms: rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        roomCode: r.roomCode,
        isPublic: r.isPublic,
        memberCount: r.memberCount ?? 0,
        admin: r.admin ? { id: r.admin.id, email: r.admin.email, firstName: r.admin.firstName, lastName: r.admin.lastName } : null,
        createdAt: r.createdAt,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  async deleteRoom(id: string) {
    const result = await this.roomRepo.delete({ id });
    if (result.affected === 0) throw new NotFoundException('Room not found');
    return { id };
  }

  // ─── Phase 2.2 — Live sessions ───────────────────────────────────────────

  async listLiveSessions() {
    const live = await this.sessionRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.room', 'room')
      .leftJoinAndSelect('s.host', 'host')
      .loadRelationCountAndMap('s.attendeeCount', 's.attendees', 'attendee', (qb) => qb.where('attendee."leftAt" IS NULL'))
      .where("s.status = 'live'")
      .orderBy('s."startedAt"', 'DESC')
      .getMany();
    return live.map((s: any) => ({
      id: s.id, title: s.title, startedAt: s.startedAt, status: s.status,
      attendeeCount: s.attendeeCount ?? 0,
      room: s.room ? { id: s.room.id, title: s.room.title } : null,
      host: s.host ? { id: s.host.id, firstName: s.host.firstName, lastName: s.host.lastName } : null,
    }));
  }

  async listSessionHistory(opts: { page?: number; limit?: number }) {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
    const qb = this.sessionRepo.createQueryBuilder('s')
      .leftJoinAndSelect('s.room', 'room')
      .leftJoinAndSelect('s.host', 'host')
      .where("s.status IN ('ended','cancelled')")
      .orderBy('s."endedAt"', 'DESC')
      .skip((page - 1) * limit).take(limit);
    const [rows, total] = await qb.getManyAndCount();
    return {
      sessions: rows.map((s) => ({
        id: s.id, title: s.title, status: s.status,
        startedAt: s.startedAt, endedAt: s.endedAt, durationMinutes: s.durationMinutes,
        room: s.room ? { id: s.room.id, title: s.room.title } : null,
        host: s.host ? { id: s.host.id, firstName: s.host.firstName, lastName: s.host.lastName } : null,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  // ─── Phase 2.3 — Broadcast announcements ─────────────────────────────────

  async broadcast(message: string, audience: 'all' | 'paid' | 'free' = 'all') {
    if (!message || message.trim().length === 0) throw new BadRequestException('Message is required');
    const where: any = {};
    if (audience === 'paid') where.subscriptionTier = In([PlanTier.BASIC, PlanTier.PRO, PlanTier.MAX]);
    if (audience === 'free') where.subscriptionTier = PlanTier.FREE;
    const users = await this.userRepo.find({ where, select: ['id'] });

    let sent = 0;
    for (const u of users) {
      try {
        await this.notificationService.sendNotificationToUser(u.id, message, { type: 'admin_broadcast' });
        sent++;
      } catch (e: any) {
        this.logger.error(`Broadcast to ${u.id} failed: ${e.message}`);
      }
    }
    return { sent, total: users.length };
  }
}
