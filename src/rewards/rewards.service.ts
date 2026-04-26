import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserStreak } from '../entities/user-streak.entity';
import { Badge, BadgeTier } from '../entities/badge.entity';
import { UserBadge } from '../entities/user-badge.entity';
import { UserChallengeProgress, ChallengeType } from '../entities/user-challenge-progress.entity';
import { ChallengeDefinition, ChallengeAction } from '../entities/challenge-definition.entity';
import { UserTierMonthlyProgress } from '../entities/user-tier-monthly-progress.entity';
import { User } from '../entities/user.entity';
import { PlanTier } from '../entities/subscription-plan.entity';
import { NotificationService } from '../notification/notification.service';
import { ConfigService } from '@nestjs/config';

// How many challenges are active per period from the full pool
const SCHEDULED_COUNT: Record<ChallengeType, number> = {
  [ChallengeType.DAILY]: 3,
  [ChallengeType.WEEKLY]: 3,
  [ChallengeType.MONTHLY]: 2,
};

// Number of challenge completions per tier required, *within a calendar month*,
// to earn the badge for that tier in that month. The user can earn the same
// badge again next month — the counter resets to 0 every month.
const BADGE_MONTHLY_THRESHOLD: Record<ChallengeType, number> = {
  [ChallengeType.DAILY]: 5,
  [ChallengeType.WEEKLY]: 4,
  [ChallengeType.MONTHLY]: 2,
};

const BADGE_TIER_MAP: Record<ChallengeType, BadgeTier> = {
  [ChallengeType.DAILY]: BadgeTier.DAILY,
  [ChallengeType.WEEKLY]: BadgeTier.WEEKLY,
  [ChallengeType.MONTHLY]: BadgeTier.MONTHLY,
};

// Plan tier hierarchy — a user on tier X sees challenges with minPlanTier <= X.
const PLAN_TIER_RANK: Record<PlanTier, number> = {
  [PlanTier.FREE]: 0,
  [PlanTier.BASIC]: 1,
  [PlanTier.PRO]: 2,
  [PlanTier.MAX]: 3,
};

@Injectable()
export class RewardsService implements OnModuleInit {
  private readonly logger = new Logger(RewardsService.name);

  constructor(
    @InjectRepository(UserStreak)
    private streakRepo: Repository<UserStreak>,
    @InjectRepository(Badge)
    private badgeRepo: Repository<Badge>,
    @InjectRepository(UserBadge)
    private userBadgeRepo: Repository<UserBadge>,
    @InjectRepository(UserChallengeProgress)
    private challengeProgressRepo: Repository<UserChallengeProgress>,
    @InjectRepository(ChallengeDefinition)
    private challengeDefRepo: Repository<ChallengeDefinition>,
    @InjectRepository(UserTierMonthlyProgress)
    private monthlyProgressRepo: Repository<UserTierMonthlyProgress>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private notificationService: NotificationService,
    private configService: ConfigService,
  ) {}

  // ─── Seed on startup ──────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    await this.seedBadges();
    await this.seedChallengeDefinitions();
  }

  private async seedBadges(): Promise<void> {
    const defs = [
      { name: 'Daily Champion',  description: 'Complete 5 daily challenges this month to unlock 10% off',   icon: 'flame',     tier: BadgeTier.DAILY,   discountPercentage: 10 },
      { name: 'Weekly Scholar',  description: 'Complete 4 weekly challenges this month to unlock 20% off',  icon: 'book-open', tier: BadgeTier.WEEKLY,  discountPercentage: 20 },
      { name: 'Monthly Master',  description: 'Complete 2 monthly challenges this month to unlock 30% off', icon: 'trophy',    tier: BadgeTier.MONTHLY, discountPercentage: 30 },
    ];
    for (const def of defs) {
      const exists = await this.badgeRepo.findOne({ where: { name: def.name } });
      if (exists) {
        await this.badgeRepo.update({ name: def.name }, { description: def.description });
      } else {
        await this.badgeRepo.save(this.badgeRepo.create(def));
        this.logger.log(`Seeded badge: ${def.name}`);
      }
    }
  }

  private async seedChallengeDefinitions(): Promise<void> {
    const defs = [
      // Daily — small targets that any user can hit on the free plan
      { name: 'Task Sprinter',    description: 'Complete 1 calendar task before its deadline',   icon: 'check-circle', tier: ChallengeType.DAILY,   actionType: ChallengeAction.CALENDAR_TASK_COMPLETED, target: 1,  points: 10, minPlanTier: PlanTier.FREE },
      { name: 'Note Creator',     description: 'Create 1 note today',                            icon: 'file-text',    tier: ChallengeType.DAILY,   actionType: ChallengeAction.NOTE_CREATED,            target: 1,  points: 10, minPlanTier: PlanTier.FREE },
      { name: 'Quiz Taker',       description: 'Complete a quiz today',                          icon: 'help-circle',  tier: ChallengeType.DAILY,   actionType: ChallengeAction.QUIZ_COMPLETED,           target: 1,  points: 15, minPlanTier: PlanTier.FREE },
      { name: 'Homework Hero',    description: 'Submit an assignment today',                     icon: 'upload',       tier: ChallengeType.DAILY,   actionType: ChallengeAction.ASSIGNMENT_SUBMITTED,     target: 1,  points: 15, minPlanTier: PlanTier.FREE },
      // Weekly
      { name: 'Weekly Achiever',  description: 'Complete 10 tasks this week',                    icon: 'target',       tier: ChallengeType.WEEKLY,  actionType: ChallengeAction.CALENDAR_TASK_COMPLETED, target: 10, points: 50, minPlanTier: PlanTier.FREE },
      { name: 'Knowledge Builder',description: 'Create 5 notes this week',                       icon: 'book',         tier: ChallengeType.WEEKLY,  actionType: ChallengeAction.NOTE_CREATED,            target: 5,  points: 50, minPlanTier: PlanTier.FREE },
      { name: 'Quiz Champion',    description: 'Complete 3 quizzes this week',                   icon: 'award',        tier: ChallengeType.WEEKLY,  actionType: ChallengeAction.QUIZ_COMPLETED,           target: 3,  points: 60, minPlanTier: PlanTier.PRO  },
      { name: 'Live Learner',     description: 'Attend a live session this week',                icon: 'video',        tier: ChallengeType.WEEKLY,  actionType: ChallengeAction.LIVE_SESSION_ATTENDED,   target: 1,  points: 40, minPlanTier: PlanTier.FREE },
      // Monthly — larger targets, restricted to paid plans where note/task limits don't bite
      { name: 'Monthly Champion', description: 'Complete 30 tasks this month',                   icon: 'star',         tier: ChallengeType.MONTHLY, actionType: ChallengeAction.CALENDAR_TASK_COMPLETED, target: 30, points: 200, minPlanTier: PlanTier.FREE },
      { name: 'Scholar',          description: 'Create 20 notes this month',                     icon: 'book-open',    tier: ChallengeType.MONTHLY, actionType: ChallengeAction.NOTE_CREATED,            target: 20, points: 150, minPlanTier: PlanTier.PRO  },
    ];
    for (const def of defs) {
      const exists = await this.challengeDefRepo.findOne({ where: { name: def.name } });
      if (exists) {
        await this.challengeDefRepo.update(
          { name: def.name },
          { target: def.target, description: def.description, minPlanTier: def.minPlanTier },
        );
      } else {
        await this.challengeDefRepo.save(this.challengeDefRepo.create(def));
        this.logger.log(`Seeded challenge: ${def.name}`);
      }
    }
  }

  // ─── Plan filter ───────────────────────────────────────────────────────────

  /** Filter a list of challenge defs by what the given tier can see. */
  private filterByPlan(defs: ChallengeDefinition[], userTier: PlanTier): ChallengeDefinition[] {
    const userRank = PLAN_TIER_RANK[userTier] ?? 0;
    return defs.filter((d) => (PLAN_TIER_RANK[d.minPlanTier] ?? 0) <= userRank);
  }

  // ─── Scheduling ────────────────────────────────────────────────────────────

  /**
   * Sliding-window rotation: each period the window shifts by 1 position,
   * giving `poolSize` distinct combinations before it repeats.
   */
  private getScheduledDefs(
    allDefs: ChallengeDefinition[],
    tier: ChallengeType,
    periodStart: Date,
  ): ChallengeDefinition[] {
    if (allDefs.length === 0) return [];
    const count = Math.min(SCHEDULED_COUNT[tier], allDefs.length);
    const sorted = [...allDefs].sort((a, b) => a.id.localeCompare(b.id));
    const periodIndex = this.getPeriodIndex(tier, periodStart);
    const startIdx = periodIndex % sorted.length;

    const selected: ChallengeDefinition[] = [];
    for (let i = 0; i < count; i++) {
      selected.push(sorted[(startIdx + i) % sorted.length]);
    }
    return selected;
  }

  private getPeriodIndex(tier: ChallengeType, periodStart: Date): number {
    const d = new Date(periodStart);
    if (tier === ChallengeType.DAILY) {
      return Math.floor(d.getTime() / (24 * 60 * 60 * 1000));
    }
    if (tier === ChallengeType.WEEKLY) {
      return Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000));
    }
    return d.getFullYear() * 12 + d.getMonth();
  }

  /** Returns the UTC time when the current period ends (challenges refresh) */
  private getPeriodEnd(tier: ChallengeType, periodStart: Date): Date {
    const d = new Date(periodStart);
    if (tier === ChallengeType.DAILY) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
    }
    if (tier === ChallengeType.WEEKLY) {
      const next = new Date(periodStart);
      next.setDate(next.getDate() + 7);
      return next;
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  }

  // ─── Public trigger method ─────────────────────────────────────────────────

  async onAction(userId: string, action: ChallengeAction, value?: number): Promise<void> {
    try {
      if (action === ChallengeAction.FOCUS_SCORE && (!value || value < 75)) return;

      const matchingDefs = await this.challengeDefRepo.find({
        where: { actionType: action, isActive: true },
      });
      if (matchingDefs.length === 0) return;

      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) return;
      const userTier = user.subscriptionTier ?? PlanTier.FREE;

      // Only definitions visible to this user's plan tier
      const visibleDefs = this.filterByPlan(matchingDefs, userTier);
      if (visibleDefs.length === 0) return;

      this.logger.log(`onAction(${action}) for user ${userId}: ${visibleDefs.length} visible def(s) on plan ${userTier}`);

      const now = new Date();
      const tierCache = new Map<ChallengeType, Set<string>>();

      for (const def of visibleDefs) {
        if (!tierCache.has(def.tier)) {
          const periodStart = this.getPeriodStart(def.tier, now);
          const allForTier = await this.challengeDefRepo.find({
            where: { tier: def.tier, isActive: true },
          });
          const visibleForTier = this.filterByPlan(allForTier, userTier);
          const scheduled = this.getScheduledDefs(visibleForTier, def.tier, periodStart);
          tierCache.set(def.tier, new Set(scheduled.map((d) => d.id)));
        }

        if (tierCache.get(def.tier)!.has(def.id)) {
          await this.incrementChallengeProgress(userId, def);
        }
      }
    } catch (error: any) {
      this.logger.error(`Rewards onAction failed for user ${userId}: ${error.message}`);
    }
  }

  onTaskCompleted(userId: string, _completedAt: Date) {
    return this.onAction(userId, ChallengeAction.CALENDAR_TASK_COMPLETED);
  }

  // ─── Core progress logic ───────────────────────────────────────────────────

  private async incrementChallengeProgress(userId: string, def: ChallengeDefinition): Promise<void> {
    const periodStart = this.getPeriodStart(def.tier, new Date());

    let progress = await this.challengeProgressRepo.findOne({
      where: {
        user: { id: userId },
        challengeDefinition: { id: def.id },
        periodStart: periodStart as any,
      },
    });

    if (!progress) {
      progress = this.challengeProgressRepo.create({
        user: { id: userId } as User,
        challengeDefinition: def,
        challengeType: def.tier,
        periodStart,
        currentCount: 0,
        isCompleted: false,
        consecutiveCount: 0, // legacy field — no longer used, kept for column compatibility
      });
    }

    if (progress.isCompleted) return;

    progress.currentCount += 1;

    let justCompleted = false;
    if (progress.currentCount >= def.target) {
      progress.isCompleted = true;
      progress.completedAt = new Date();
      justCompleted = true;
    }

    await this.challengeProgressRepo.save(progress);

    if (justCompleted) {
      // Increment the per-month counter for this tier — drives badge eligibility
      await this.incrementMonthlyCounter(userId, def.tier);
      await this.checkAndAwardBadge(userId, def.tier);
    }
  }

  private async incrementMonthlyCounter(userId: string, tier: ChallengeType): Promise<void> {
    const periodMonth = this.getMonthStart(new Date());

    let row = await this.monthlyProgressRepo.findOne({
      where: { user: { id: userId }, tier, periodMonth: periodMonth as any },
    });

    if (!row) {
      row = this.monthlyProgressRepo.create({
        user: { id: userId } as User,
        tier,
        periodMonth,
        completedCount: 1,
      });
    } else {
      row.completedCount += 1;
    }

    await this.monthlyProgressRepo.save(row);
  }

  private async updateStreak(userId: string, date: Date): Promise<void> {
    let streak = await this.streakRepo.findOne({ where: { user: { id: userId } } });
    if (!streak) {
      streak = this.streakRepo.create({ user: { id: userId } as User, currentStreak: 0, longestStreak: 0 });
    }

    const today = this.toDateOnly(date);
    const last = streak.lastActivityDate ? this.toDateOnly(new Date(streak.lastActivityDate)) : null;

    if (last && this.isSameDay(last, today)) {
      // already counted today
    } else if (last && this.isConsecutiveDay(last, today)) {
      streak.currentStreak += 1;
    } else {
      streak.currentStreak = 1;
    }

    if (streak.currentStreak > streak.longestStreak) streak.longestStreak = streak.currentStreak;
    streak.lastActivityDate = today;
    await this.streakRepo.save(streak);
  }

  /** Award the badge for this tier IF the user's monthly counter has reached the threshold. */
  private async checkAndAwardBadge(userId: string, tier: ChallengeType): Promise<void> {
    const threshold = BADGE_MONTHLY_THRESHOLD[tier];
    const periodMonth = this.getMonthStart(new Date());

    const counter = await this.monthlyProgressRepo.findOne({
      where: { user: { id: userId }, tier, periodMonth: periodMonth as any },
    });
    if (!counter || counter.completedCount < threshold) return;

    const badge = await this.badgeRepo.findOne({ where: { tier: BADGE_TIER_MAP[tier], isActive: true } });
    if (!badge) return;

    // One badge per (user, badge, month). If they already have it for this
    // month, don't award again.
    const alreadyEarned = await this.userBadgeRepo.findOne({
      where: {
        user: { id: userId },
        badge: { id: badge.id },
        periodMonth: periodMonth as any,
      },
    });
    if (alreadyEarned) return;

    const discountCode = await this.createLsDiscountCode(badge.discountPercentage);
    const userBadge = this.userBadgeRepo.create({
      user: { id: userId } as User,
      badge,
      earnedAt: new Date(),
      periodMonth,
      lsDiscountCode: discountCode ?? undefined,
      isRedeemed: false,
    });
    await this.userBadgeRepo.save(userBadge);

    await this.notificationService.sendNotificationToUser(
      userId,
      `🏆 You earned the "${badge.name}" badge for ${this.formatMonth(periodMonth)}! Enjoy ${badge.discountPercentage}% off any subscription plan.`,
      { type: 'badge', badgeId: badge.id, actionUrl: '/rewards' },
    );
    this.logger.log(`Awarded badge "${badge.name}" to user ${userId} for ${this.formatMonth(periodMonth)}`);
  }

  private async createLsDiscountCode(discountPercent: number): Promise<string | null> {
    try {
      const apiKey = this.configService.get<string>('LEMON_SQUEEZY_API_KEY');
      const storeId = this.configService.get<string>('LEMON_SQUEEZY_STORE_ID');
      if (!apiKey || apiKey.startsWith('your_') || !storeId) {
        this.logger.warn(`LS not configured — apiKey set: ${!!apiKey}, storeId: ${storeId}`);
        return null;
      }

      const code = `BADGE${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const response = await fetch('https://api.lemonsqueezy.com/v1/discounts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify({
          data: {
            type: 'discounts',
            attributes: {
              name: `Badge ${discountPercent}% Off`,
              code,
              amount: discountPercent,
              amount_type: 'percent',
              is_limited_to_products: false,
              is_limited_redemptions: true,
              max_redemptions: 1,
            },
            relationships: { store: { data: { type: 'stores', id: String(storeId) } } },
          },
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        this.logger.error(`LS discount creation failed (${response.status}): ${body}`);
        return null;
      }
      this.logger.log(`Created LS discount code ${code} (${discountPercent}% off)`);
      return code;
    } catch (error: any) {
      this.logger.error(`LS discount code creation failed: ${error.message}`);
      return null;
    }
  }

  /** Lazy retry — backfill discount codes for any earned badges that don't have one yet. */
  async backfillMissingDiscountCodes(userId?: string): Promise<{ fixed: number }> {
    const where: any = userId ? { user: { id: userId } } : {};
    const badges = await this.userBadgeRepo.find({ where, relations: ['badge'] });
    const needsCode = badges.filter((b) => !b.lsDiscountCode);
    if (needsCode.length === 0) return { fixed: 0 };

    let fixed = 0;
    for (const ub of needsCode) {
      const code = await this.createLsDiscountCode(ub.badge.discountPercentage);
      if (code) {
        await this.userBadgeRepo.update({ id: ub.id }, { lsDiscountCode: code });
        fixed++;
      }
    }
    if (fixed > 0) this.logger.log(`Auto-backfilled ${fixed} discount code(s)${userId ? ` for user ${userId}` : ''}`);
    return { fixed };
  }

  // ─── Query methods ─────────────────────────────────────────────────────────

  async getUserRewardsProfile(userId: string) {
    await this.updateStreak(userId, new Date()).catch((e) =>
      this.logger.error(`Streak update failed: ${e.message}`),
    );

    this.backfillMissingDiscountCodes(userId).catch((e) =>
      this.logger.error(`Auto-backfill failed: ${e.message}`),
    );

    const streak = await this.streakRepo.findOne({ where: { user: { id: userId } } });

    const allBadges = await this.badgeRepo.find({
      where: { isActive: true },
      order: { discountPercentage: 'ASC' },
    });
    const userBadges = await this.userBadgeRepo.find({
      where: { user: { id: userId } },
      relations: ['badge'],
      order: { earnedAt: 'DESC' },
    });

    // Current month's earned badges, keyed by badge id, for the "current state" cards
    const currentMonth = this.getMonthStart(new Date());
    const currentMonthBadgeMap = new Map(
      userBadges
        .filter((ub) => this.isSameMonth(new Date(ub.periodMonth), currentMonth))
        .map((ub) => [ub.badge.id, ub]),
    );

    const badges = allBadges.map((badge) => ({
      badge,
      userBadge: currentMonthBadgeMap.get(badge.id) ?? null,
    }));

    // Per-tier monthly progress for the current month (drives the X/threshold display)
    const monthlyProgress = await this.monthlyProgressRepo.find({
      where: { user: { id: userId }, periodMonth: currentMonth as any },
    });
    const monthlyProgressByTier: Record<string, { completed: number; threshold: number }> = {
      daily:   { completed: 0, threshold: BADGE_MONTHLY_THRESHOLD[ChallengeType.DAILY] },
      weekly:  { completed: 0, threshold: BADGE_MONTHLY_THRESHOLD[ChallengeType.WEEKLY] },
      monthly: { completed: 0, threshold: BADGE_MONTHLY_THRESHOLD[ChallengeType.MONTHLY] },
    };
    for (const row of monthlyProgress) {
      monthlyProgressByTier[row.tier] = {
        completed: row.completedCount,
        threshold: BADGE_MONTHLY_THRESHOLD[row.tier as ChallengeType],
      };
    }

    // Group historical earned badges by month for the timeline UI
    const badgeHistoryMap = new Map<string, Array<{ badge: Badge; userBadge: UserBadge }>>();
    for (const ub of userBadges) {
      const key = this.formatMonthKey(new Date(ub.periodMonth));
      const arr = badgeHistoryMap.get(key) ?? [];
      arr.push({ badge: ub.badge, userBadge: ub });
      badgeHistoryMap.set(key, arr);
    }
    const badgeHistory = Array.from(badgeHistoryMap.entries())
      .map(([periodMonth, items]) => ({ periodMonth, badges: items }))
      .sort((a, b) => b.periodMonth.localeCompare(a.periodMonth));

    const challenges = await this.getUserChallenges(userId);
    const totalPoints = challenges
      .filter((c) => c.isCompleted)
      .reduce((sum, c) => sum + c.points, 0);

    return {
      streak: streak ?? { currentStreak: 0, longestStreak: 0, lastActivityDate: null },
      badges,
      monthlyProgress: monthlyProgressByTier,
      badgeHistory,
      totalPoints,
      challenges,
    };
  }

  async getUserChallenges(userId: string) {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    const userTier = user?.subscriptionTier ?? PlanTier.FREE;

    const now = new Date();
    const results: Array<{
      id: string; name: string; description: string; icon: string;
      type: ChallengeType; actionType: ChallengeAction;
      currentCount: number; target: number; isCompleted: boolean;
      points: number;
      periodStart: string; expiresAt: string;
    }> = [];

    for (const tier of [ChallengeType.DAILY, ChallengeType.WEEKLY, ChallengeType.MONTHLY]) {
      const periodStart = this.getPeriodStart(tier, now);
      const expiresAt = this.getPeriodEnd(tier, periodStart);
      const allDefs = await this.challengeDefRepo.find({ where: { tier, isActive: true } });
      const visibleDefs = this.filterByPlan(allDefs, userTier);
      const scheduledDefs = this.getScheduledDefs(visibleDefs, tier, periodStart);

      for (const def of scheduledDefs) {
        const progress = await this.challengeProgressRepo.findOne({
          where: {
            user: { id: userId },
            challengeDefinition: { id: def.id },
            periodStart: periodStart as any,
          },
        });

        results.push({
          id: def.id,
          name: def.name,
          description: def.description,
          icon: def.icon,
          type: def.tier,
          actionType: def.actionType,
          currentCount: progress?.currentCount ?? 0,
          target: def.target,
          isCompleted: progress?.isCompleted ?? false,
          points: def.points,
          periodStart: periodStart.toISOString(),
          expiresAt: expiresAt.toISOString(),
        });
      }
    }
    return results;
  }

  // ─── Date helpers ──────────────────────────────────────────────────────────

  private getPeriodStart(type: ChallengeType, date: Date): Date {
    const d = new Date(date);
    if (type === ChallengeType.DAILY) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    if (type === ChallengeType.WEEKLY) {
      const day = d.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day;
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }

  /** First day of the calendar month containing `date` (UTC). */
  private getMonthStart(date: Date): Date {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  private isSameMonth(a: Date, b: Date): boolean {
    return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
  }

  private formatMonth(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  private formatMonthKey(d: Date): string {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private toDateOnly(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  private isSameDay(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  }

  private isConsecutiveDay(past: Date, today: Date): boolean {
    const diff = today.getTime() - past.getTime();
    return diff > 0 && diff <= 25 * 60 * 60 * 1000;
  }
}
