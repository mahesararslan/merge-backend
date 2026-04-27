import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { In } from 'typeorm';
import { SubscriptionPlan, PlanTier, PlanRole } from '../entities/subscription-plan.entity';
import { Badge, BadgeTier } from '../entities/badge.entity';
import { ChallengeDefinition, ChallengeAction } from '../entities/challenge-definition.entity';
import { ChallengeType } from '../entities/user-challenge-progress.entity';

@Injectable()
export class SubscriptionSeedService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionSeedService.name);

  constructor(
    @InjectRepository(SubscriptionPlan)
    private planRepo: Repository<SubscriptionPlan>,
    @InjectRepository(Badge)
    private badgeRepo: Repository<Badge>,
    @InjectRepository(ChallengeDefinition)
    private challengeDefRepo: Repository<ChallengeDefinition>,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.seedPlans();
    await this.seedBadges();
    await this.seedChallengeDefinitions();
    await this.syncVariantIds();
  }

  /** Reads LS variant IDs from env and updates the matching plan rows */
  private async syncVariantIds() {
    const variantMap: Partial<Record<PlanTier, string | undefined>> = {
      [PlanTier.STUDENT_PLUS]:        this.configService.get<string>('LEMON_SQUEEZY_STUDENT_PLUS_VARIANT_ID'),
      [PlanTier.INSTRUCTOR_EDUCATOR]: this.configService.get<string>('LEMON_SQUEEZY_EDUCATOR_VARIANT_ID'),
      [PlanTier.INSTRUCTOR_PRO]:      this.configService.get<string>('LEMON_SQUEEZY_INSTRUCTOR_PRO_VARIANT_ID'),
    };

    for (const [tier, variantId] of Object.entries(variantMap)) {
      if (!variantId || variantId.startsWith('your_')) continue;
      await this.planRepo.update({ name: tier as PlanTier }, { lsVariantId: variantId });
      this.logger.log(`Updated ${tier} plan variant ID`);
    }
  }

  private async seedPlans() {
    // Deactivate legacy plans so they don't appear on /billing for new signups
    const legacy = [PlanTier.FREE, PlanTier.BASIC, PlanTier.PRO, PlanTier.MAX];
    await this.planRepo.update({ name: In(legacy) }, { isActive: false });

    // Upsert each new plan: insert if missing, update fields if exists.
    const plans: Partial<SubscriptionPlan>[] = [
      // ── Student plans ───────────────────────────────────────────────────────
      {
        name: PlanTier.STUDENT_FREE,
        displayName: 'Student Free',
        priceMonthly: 0,
        currency: 'PKR',
        features: ['Join unlimited rooms', '5 notes', 'Calendar tasks', 'Daily challenges'],
        targetRole: PlanRole.STUDENT,
        roomLimit: 0,
        noteLimit: 5,
        studentsPerRoom: 0,
        hasLectureSummary: false,
        hasFocusTracker: false,
        hasAiAssistant: false,
        hasQaBot: false,
        isActive: true,
      },
      {
        name: PlanTier.STUDENT_PLUS,
        displayName: 'Student Plus',
        priceMonthly: 200,
        currency: 'PKR',
        features: ['Unlimited notes', 'AI Assistant', 'Focus tracker'],
        targetRole: PlanRole.STUDENT,
        roomLimit: 0,
        noteLimit: -1,
        studentsPerRoom: 0,
        hasLectureSummary: false,
        hasFocusTracker: true,
        hasAiAssistant: true,
        hasQaBot: false,
        isActive: true,
      },
      // ── Instructor plans ────────────────────────────────────────────────────
      {
        name: PlanTier.INSTRUCTOR_STARTER,
        displayName: 'Instructor Starter',
        priceMonthly: 0,
        currency: 'PKR',
        features: ['2 rooms', 'Up to 20 students/room', '10 notes', 'Quizzes & assignments', 'Live sessions'],
        targetRole: PlanRole.INSTRUCTOR,
        roomLimit: 2,
        noteLimit: 10,
        studentsPerRoom: 20,
        hasLectureSummary: false,
        hasFocusTracker: false,
        hasAiAssistant: false,
        hasQaBot: false,
        isActive: true,
      },
      {
        name: PlanTier.INSTRUCTOR_EDUCATOR,
        displayName: 'Educator',
        priceMonthly: 500,
        currency: 'PKR',
        features: ['10 rooms', 'Up to 100 students/room', 'Unlimited notes', 'AI Assistant', 'AI lecture summaries (shared with room)'],
        targetRole: PlanRole.INSTRUCTOR,
        roomLimit: 10,
        noteLimit: -1,
        studentsPerRoom: 100,
        hasLectureSummary: true,
        hasFocusTracker: false,
        hasAiAssistant: true,
        hasQaBot: false,
        isActive: true,
      },
      {
        name: PlanTier.INSTRUCTOR_PRO,
        displayName: 'Instructor Pro',
        priceMonthly: 1500,
        currency: 'PKR',
        features: ['Unlimited rooms', 'Unlimited students/room', 'Unlimited notes', 'AI Assistant', 'Lecture summaries', 'AI bot answers in Live Q&A'],
        targetRole: PlanRole.INSTRUCTOR,
        roomLimit: -1,
        noteLimit: -1,
        studentsPerRoom: -1,
        hasLectureSummary: true,
        hasFocusTracker: false,
        hasAiAssistant: true,
        hasQaBot: true,
        isActive: true,
      },
    ];

    for (const plan of plans) {
      const existing = await this.planRepo.findOne({ where: { name: plan.name } });
      if (existing) {
        // Don't clobber the LS variant ID — that's set separately by syncVariantIds()
        const { lsVariantId, ...updates } = plan as any;
        void lsVariantId;
        await this.planRepo.update({ name: plan.name }, updates);
      } else {
        await this.planRepo.save(this.planRepo.create(plan as SubscriptionPlan));
        this.logger.log(`Seeded plan: ${plan.name}`);
      }
    }
  }

  private async seedBadges() {
    const count = await this.badgeRepo.count();
    if (count > 0) return;

    const badges: Partial<Badge>[] = [
      {
        name: 'Daily Champion',
        description: 'Complete the daily challenge for 7 consecutive days',
        icon: 'flame',
        tier: BadgeTier.DAILY,
        discountPercentage: 10,
        isActive: true,
      },
      {
        name: 'Weekly Scholar',
        description: 'Complete the weekly challenge for 4 consecutive weeks',
        icon: 'book-open',
        tier: BadgeTier.WEEKLY,
        discountPercentage: 20,
        isActive: true,
      },
      {
        name: 'Monthly Master',
        description: 'Complete the monthly challenge in a calendar month',
        icon: 'trophy',
        tier: BadgeTier.MONTHLY,
        discountPercentage: 30,
        isActive: true,
      },
    ];

    await this.badgeRepo.save(this.badgeRepo.create(badges as Badge[]));
    this.logger.log('Seeded 3 badges');
  }

  private async seedChallengeDefinitions() {
    const count = await this.challengeDefRepo.count();
    if (count >= 15) return; // Already seeded with all 15 challenges

    const defs: Partial<ChallengeDefinition>[] = [
      // ── Daily (6 challenges — show 3 per day, 6 different combinations) ────
      {
        name: 'Task Slayer',
        description: 'Complete 3 calendar tasks before their deadline today',
        icon: 'check-circle',
        tier: ChallengeType.DAILY,
        actionType: ChallengeAction.CALENDAR_TASK_COMPLETED,
        target: 3,
        points: 30,
      },
      {
        name: 'Note Taker',
        description: 'Create 2 notes today',
        icon: 'file-text',
        tier: ChallengeType.DAILY,
        actionType: ChallengeAction.NOTE_CREATED,
        target: 2,
        points: 20,
      },
      {
        name: 'Room Activator',
        description: 'Join or create a room today',
        icon: 'users',
        tier: ChallengeType.DAILY,
        actionType: ChallengeAction.ROOM_JOINED,
        target: 1,
        points: 15,
      },
      {
        name: 'Focus Achiever',
        description: 'Earn a focus score of 75+ in a live session',
        icon: 'target',
        tier: ChallengeType.DAILY,
        actionType: ChallengeAction.FOCUS_SCORE,
        target: 1,
        points: 25,
      },
      {
        name: 'Quick Quiz',
        description: 'Complete 1 quiz today',
        icon: 'help-circle',
        tier: ChallengeType.DAILY,
        actionType: ChallengeAction.QUIZ_COMPLETED,
        target: 1,
        points: 20,
      },
      {
        name: 'Session Starter',
        description: 'Attend 1 live session today',
        icon: 'video',
        tier: ChallengeType.DAILY,
        actionType: ChallengeAction.LIVE_SESSION_ATTENDED,
        target: 1,
        points: 20,
      },

      // ── Weekly (5 challenges — show 3 per week, 5 different combinations) ──
      {
        name: 'Consistent Learner',
        description: 'Complete 10 calendar tasks this week',
        icon: 'calendar-check',
        tier: ChallengeType.WEEKLY,
        actionType: ChallengeAction.CALENDAR_TASK_COMPLETED,
        target: 10,
        points: 100,
      },
      {
        name: 'Knowledge Builder',
        description: 'Create 5 notes this week',
        icon: 'book-open',
        tier: ChallengeType.WEEKLY,
        actionType: ChallengeAction.NOTE_CREATED,
        target: 5,
        points: 75,
      },
      {
        name: 'Live Session Pro',
        description: 'Attend 3 live sessions this week',
        icon: 'video',
        tier: ChallengeType.WEEKLY,
        actionType: ChallengeAction.LIVE_SESSION_ATTENDED,
        target: 3,
        points: 80,
      },
      {
        name: 'Quiz Warrior',
        description: 'Complete 2 quizzes this week',
        icon: 'help-circle',
        tier: ChallengeType.WEEKLY,
        actionType: ChallengeAction.QUIZ_COMPLETED,
        target: 2,
        points: 60,
      },
      {
        name: 'Room Builder',
        description: 'Create a new room this week',
        icon: 'plus-circle',
        tier: ChallengeType.WEEKLY,
        actionType: ChallengeAction.ROOM_CREATED,
        target: 1,
        points: 50,
      },

      // ── Monthly (4 challenges) ────────────────────────────────────────────
      {
        name: 'Calendar Champion',
        description: 'Complete 30 calendar tasks this month',
        icon: 'trophy',
        tier: ChallengeType.MONTHLY,
        actionType: ChallengeAction.CALENDAR_TASK_COMPLETED,
        target: 30,
        points: 300,
      },
      {
        name: 'Prolific Writer',
        description: 'Create 15 notes this month',
        icon: 'pen-line',
        tier: ChallengeType.MONTHLY,
        actionType: ChallengeAction.NOTE_CREATED,
        target: 15,
        points: 200,
      },
      {
        name: 'Dedicated Learner',
        description: 'Attend 10 live sessions this month',
        icon: 'monitor',
        tier: ChallengeType.MONTHLY,
        actionType: ChallengeAction.LIVE_SESSION_ATTENDED,
        target: 10,
        points: 250,
      },
      {
        name: 'Assignment Hero',
        description: 'Submit 3 assignments this month',
        icon: 'clipboard-check',
        tier: ChallengeType.MONTHLY,
        actionType: ChallengeAction.ASSIGNMENT_SUBMITTED,
        target: 3,
        points: 150,
      },
    ];

    await this.challengeDefRepo.save(this.challengeDefRepo.create(defs as ChallengeDefinition[]));
    this.logger.log(`Seeded ${defs.length} challenge definitions`);
  }
}
