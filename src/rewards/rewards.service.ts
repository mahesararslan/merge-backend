import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserStreak } from '../entities/user-streak.entity';
import { Badge, BadgeTier } from '../entities/badge.entity';
import { UserBadge } from '../entities/user-badge.entity';
import { UserChallengeProgress, ChallengeType } from '../entities/user-challenge-progress.entity';
import { ChallengeDefinition, ChallengeAction } from '../entities/challenge-definition.entity';
import { User } from '../entities/user.entity';
import { NotificationService } from '../notification/notification.service';
import { ConfigService } from '@nestjs/config';

// How many challenges are active per period from the full pool
const SCHEDULED_COUNT: Record<ChallengeType, number> = {
  [ChallengeType.DAILY]: 3,
  [ChallengeType.WEEKLY]: 3,
  [ChallengeType.MONTHLY]: 2,
};

// ⚠️ TEST VALUES — change back to 7/4/1 before production
const BADGE_CONSECUTIVE_THRESHOLD: Record<ChallengeType, number> = {
  [ChallengeType.DAILY]: 1,   // prod: 7
  [ChallengeType.WEEKLY]: 1,  // prod: 4
  [ChallengeType.MONTHLY]: 1,
};

const BADGE_TIER_MAP: Record<ChallengeType, BadgeTier> = {
  [ChallengeType.DAILY]: BadgeTier.DAILY,
  [ChallengeType.WEEKLY]: BadgeTier.WEEKLY,
  [ChallengeType.MONTHLY]: BadgeTier.MONTHLY,
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
      { name: 'Daily Champion',  description: 'Complete all your daily challenges to unlock 10% off',   icon: 'flame',     tier: BadgeTier.DAILY,   discountPercentage: 10 },
      { name: 'Weekly Scholar',  description: 'Complete all your weekly challenges to unlock 20% off',  icon: 'book-open', tier: BadgeTier.WEEKLY,  discountPercentage: 20 },
      { name: 'Monthly Master',  description: 'Complete all your monthly challenges to unlock 30% off', icon: 'trophy',    tier: BadgeTier.MONTHLY, discountPercentage: 30 },
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
      // Daily — ⚠️ targets set to 1 for testing. Prod: Task Sprinter→3, Note Creator→2
      { name: 'Task Sprinter',    description: 'Complete 1 calendar task before its deadline',   icon: 'check-circle', tier: ChallengeType.DAILY,   actionType: ChallengeAction.CALENDAR_TASK_COMPLETED, target: 1,  points: 10 },
      { name: 'Note Creator',     description: 'Create 1 note today',                            icon: 'file-text',    tier: ChallengeType.DAILY,   actionType: ChallengeAction.NOTE_CREATED,            target: 1,  points: 10 },
      { name: 'Quiz Taker',       description: 'Complete a quiz today',                          icon: 'help-circle',  tier: ChallengeType.DAILY,   actionType: ChallengeAction.QUIZ_COMPLETED,           target: 1,  points: 15 },
      { name: 'Homework Hero',    description: 'Submit an assignment today',                      icon: 'upload',       tier: ChallengeType.DAILY,   actionType: ChallengeAction.ASSIGNMENT_SUBMITTED,     target: 1,  points: 15 },
      // Weekly (pool ≥ 3)
      { name: 'Weekly Achiever',  description: 'Complete 10 tasks this week',                     icon: 'target',       tier: ChallengeType.WEEKLY,  actionType: ChallengeAction.CALENDAR_TASK_COMPLETED, target: 10, points: 50 },
      { name: 'Knowledge Builder',description: 'Create 5 notes this week',                        icon: 'book',         tier: ChallengeType.WEEKLY,  actionType: ChallengeAction.NOTE_CREATED,            target: 5,  points: 50 },
      { name: 'Quiz Champion',    description: 'Complete 3 quizzes this week',                    icon: 'award',        tier: ChallengeType.WEEKLY,  actionType: ChallengeAction.QUIZ_COMPLETED,           target: 3,  points: 60 },
      { name: 'Live Learner',     description: 'Attend a live session this week',                 icon: 'video',        tier: ChallengeType.WEEKLY,  actionType: ChallengeAction.LIVE_SESSION_ATTENDED,   target: 1,  points: 40 },
      // Monthly (pool ≥ 2)
      { name: 'Monthly Champion', description: 'Complete 30 tasks this month',                    icon: 'star',         tier: ChallengeType.MONTHLY, actionType: ChallengeAction.CALENDAR_TASK_COMPLETED, target: 30, points: 200 },
      { name: 'Scholar',          description: 'Create 20 notes this month',                      icon: 'book-open',    tier: ChallengeType.MONTHLY, actionType: ChallengeAction.NOTE_CREATED,            target: 20, points: 150 },
    ];
    for (const def of defs) {
      const exists = await this.challengeDefRepo.findOne({ where: { name: def.name } });
      if (exists) {
        // Update target in case it changed (for testing vs production)
        await this.challengeDefRepo.update({ name: def.name }, { target: def.target, description: def.description });
      } else {
        await this.challengeDefRepo.save(this.challengeDefRepo.create(def));
        this.logger.log(`Seeded challenge: ${def.name}`);
      }
    }
  }

  // ─── Scheduling ────────────────────────────────────────────────────────────

  /**
   * Sliding-window rotation: each period the window shifts by 1 position,
   * giving `poolSize` distinct combinations before it repeats.
   *
   * Example — pool of 6 daily challenges, showing 3 per day:
   *   Day 0: [0,1,2]  Day 1: [1,2,3]  Day 2: [2,3,4]
   *   Day 3: [3,4,5]  Day 4: [4,5,0]  Day 5: [5,0,1]  → repeats on Day 6
   */
  private getScheduledDefs(
    allDefs: ChallengeDefinition[],
    tier: ChallengeType,
    periodStart: Date,
  ): ChallengeDefinition[] {
    if (allDefs.length === 0) return [];
    const count = Math.min(SCHEDULED_COUNT[tier], allDefs.length);

    // Sort deterministically so the rotation is consistent across all users
    const sorted = [...allDefs].sort((a, b) => a.id.localeCompare(b.id));

    // Period index: a monotonically increasing integer unique to each period
    const periodIndex = this.getPeriodIndex(tier, periodStart);

    // Sliding window: start shifts by 1 each period, wraps around pool
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
      // Days since Unix epoch (UTC)
      return Math.floor(d.getTime() / (24 * 60 * 60 * 1000));
    }
    if (tier === ChallengeType.WEEKLY) {
      return Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000));
    }
    // Monthly: months since year 0
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

      // Find all challenge definitions that match this action
      const matchingDefs = await this.challengeDefRepo.find({
        where: { actionType: action, isActive: true },
      });
      this.logger.log(`onAction(${action}) for user ${userId}: ${matchingDefs.length} matching def(s)`);
      if (matchingDefs.length === 0) return;

      const now = new Date();

      // Group by tier and check if each def is currently scheduled
      const tierCache = new Map<ChallengeType, Set<string>>();

      for (const def of matchingDefs) {
        if (!tierCache.has(def.tier)) {
          const periodStart = this.getPeriodStart(def.tier, now);
          const allForTier = await this.challengeDefRepo.find({
            where: { tier: def.tier, isActive: true },
          });
          const scheduled = this.getScheduledDefs(allForTier, def.tier, periodStart);
          tierCache.set(def.tier, new Set(scheduled.map((d) => d.id)));
          this.logger.log(`  ${def.tier} scheduled today: ${scheduled.map((d) => d.name).join(', ')}`);
        }

        if (tierCache.get(def.tier)!.has(def.id)) {
          this.logger.log(`  ✓ Incrementing "${def.name}" (${def.tier})`);
          await this.incrementChallengeProgress(userId, def);
        } else {
          this.logger.log(`  ✗ "${def.name}" (${def.tier}) not scheduled today, skipping`);
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
        consecutiveCount: 0,
      });
    }

    if (progress.isCompleted) return;

    progress.currentCount += 1;

    if (progress.currentCount >= def.target) {
      progress.isCompleted = true;
      progress.completedAt = new Date();

      const prevPeriodStart = this.getPreviousPeriodStart(def.tier, periodStart);
      const prev = await this.challengeProgressRepo.findOne({
        where: {
          user: { id: userId },
          challengeDefinition: { id: def.id },
          periodStart: prevPeriodStart as any,
          isCompleted: true,
        },
      });
      progress.consecutiveCount = prev ? prev.consecutiveCount + 1 : 1;
    }

    await this.challengeProgressRepo.save(progress);

    if (progress.isCompleted) {
      await this.checkAndAwardBadge(userId, def.tier);
    }
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

  private async checkAndAwardBadge(userId: string, tier: ChallengeType): Promise<void> {
    const threshold = BADGE_CONSECUTIVE_THRESHOLD[tier];
    const now = new Date();
    const currentPeriodStart = this.getPeriodStart(tier, now);

    // Only look at the scheduled challenges for this period
    const allDefs = await this.challengeDefRepo.find({ where: { tier, isActive: true } });
    const scheduledDefs = this.getScheduledDefs(allDefs, tier, currentPeriodStart);
    if (scheduledDefs.length === 0) return;

    // All scheduled challenges must be completed this period
    const completedInPeriod = await Promise.all(
      scheduledDefs.map((def) =>
        this.challengeProgressRepo.findOne({
          where: {
            user: { id: userId },
            challengeDefinition: { id: def.id },
            periodStart: currentPeriodStart as any,
            isCompleted: true,
          },
        }),
      ),
    );
    if (completedInPeriod.some((p) => !p)) return;

    const consecutiveCounts = completedInPeriod.map((p) => p!.consecutiveCount);
    const minConsecutive = Math.min(...consecutiveCounts);
    if (minConsecutive < threshold) return;

    const badge = await this.badgeRepo.findOne({ where: { tier: BADGE_TIER_MAP[tier], isActive: true } });
    if (!badge) return;

    const alreadyEarned = await this.userBadgeRepo.findOne({
      where: { user: { id: userId }, badge: { id: badge.id } },
    });
    if (alreadyEarned) return;

    const discountCode = await this.createLsDiscountCode(badge.discountPercentage);
    const userBadge = this.userBadgeRepo.create({
      user: { id: userId } as User,
      badge,
      earnedAt: new Date(),
      lsDiscountCode: discountCode ?? undefined,
      isRedeemed: false,
    });
    await this.userBadgeRepo.save(userBadge);

    await this.notificationService.sendNotificationToUser(
      userId,
      `🏆 You earned the "${badge.name}" badge! Enjoy ${badge.discountPercentage}% off any subscription plan.`,
      { type: 'badge', badgeId: badge.id, actionUrl: '/rewards' },
    );
    this.logger.log(`Awarded badge "${badge.name}" to user ${userId}`);
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

  /** Backfills discount codes for badges that have isDiscountCode=null */
  /**
   * Lazy retry — attempts to create discount codes for any earned badges
   * that don't have one yet. Called automatically on every rewards profile fetch
   * so failures during initial badge award self-heal next time the user visits /rewards.
   */
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
    // Tick the daily-usage streak — viewing the rewards page / dashboard counts as a "login"
    await this.updateStreak(userId, new Date()).catch((e) =>
      this.logger.error(`Streak update failed: ${e.message}`),
    );

    // Self-heal: retry creating LemonSqueezy discount codes for any badges
    // that didn't get one when first awarded (e.g. LS API was down or misconfigured).
    // Fire-and-forget so it doesn't slow down the response.
    this.backfillMissingDiscountCodes(userId).catch((e) =>
      this.logger.error(`Auto-backfill failed: ${e.message}`),
    );

    const streak = await this.streakRepo.findOne({ where: { user: { id: userId } } });

    // Return ALL badge definitions enriched with the user's earned status
    const allBadges = await this.badgeRepo.find({
      where: { isActive: true },
      order: { discountPercentage: 'ASC' },
    });
    const userBadges = await this.userBadgeRepo.find({
      where: { user: { id: userId } },
      relations: ['badge'],
    });
    const userBadgeMap = new Map(userBadges.map((ub) => [ub.badge.id, ub]));
    const badges = allBadges.map((badge) => ({
      badge,
      userBadge: userBadgeMap.get(badge.id) ?? null,
    }));

    const challenges = await this.getUserChallenges(userId);
    const totalPoints = challenges
      .filter((c) => c.isCompleted)
      .reduce((sum, c) => sum + c.points, 0);

    return {
      streak: streak ?? { currentStreak: 0, longestStreak: 0, lastActivityDate: null },
      badges,
      totalPoints,
      challenges,
    };
  }

  async getUserChallenges(userId: string) {
    const now = new Date();
    const results: Array<{
      id: string; name: string; description: string; icon: string;
      type: ChallengeType; actionType: ChallengeAction;
      currentCount: number; target: number; isCompleted: boolean;
      consecutiveCount: number; points: number;
      periodStart: string; expiresAt: string;
    }> = [];

    for (const tier of [ChallengeType.DAILY, ChallengeType.WEEKLY, ChallengeType.MONTHLY]) {
      const periodStart = this.getPeriodStart(tier, now);
      const expiresAt = this.getPeriodEnd(tier, periodStart);
      const allDefs = await this.challengeDefRepo.find({ where: { tier, isActive: true } });
      const scheduledDefs = this.getScheduledDefs(allDefs, tier, periodStart);

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
          consecutiveCount: progress?.consecutiveCount ?? 0,
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
      const day = d.getUTCDay(); // 0=Sun
      const diff = day === 0 ? -6 : 1 - day; // Monday start
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }

  private getPreviousPeriodStart(type: ChallengeType, current: Date): Date {
    const d = new Date(current);
    if (type === ChallengeType.DAILY) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 1));
    }
    if (type === ChallengeType.WEEKLY) {
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - 7));
    }
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
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
