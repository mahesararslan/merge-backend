import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { PlanTier, PlanRole } from './subscription-plan.entity';

// Defined here (not in user-challenge-progress.entity.ts) to avoid circular import
export enum ChallengeType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export enum ChallengeAction {
  CALENDAR_TASK_COMPLETED = 'calendar_task_completed',
  NOTE_CREATED = 'note_created',
  ROOM_CREATED = 'room_created',
  ROOM_JOINED = 'room_joined',
  LIVE_SESSION_ATTENDED = 'live_session_attended',
  QUIZ_COMPLETED = 'quiz_completed',
  ASSIGNMENT_SUBMITTED = 'assignment_submitted',
  FOCUS_SCORE = 'focus_score',
}

@Entity('challenge_definitions')
export class ChallengeDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  description: string;

  @Column()
  icon: string;

  @Column({ type: 'enum', enum: ChallengeType })
  tier: ChallengeType;

  @Column({ type: 'enum', enum: ChallengeAction })
  actionType: ChallengeAction;

  @Column()
  target: number;

  @Column({ default: 0 })
  points: number;

  // Minimum plan a user must be on for this challenge to appear.
  // Free users only see free-tier challenges; paying users see free + their tier.
  // Stored as varchar (not enum) for portability with the existing migration.
  @Column({ name: 'min_plan_tier', type: 'varchar', length: 20, default: PlanTier.FREE })
  minPlanTier: PlanTier;

  // Which role the challenge is for. Students never see instructor-only
  // challenges and vice-versa. ALL means the challenge applies to both.
  @Column({ name: 'target_role', type: 'enum', enum: PlanRole, default: PlanRole.ALL })
  targetRole: PlanRole;

  // Calendar window — challenge only appears when now is in [periodStart, periodEnd).
  // Admin-created challenges always have these set; legacy NULL rows are pruned by cron.
  @Column({ name: 'period_start', type: 'date', nullable: true })
  periodStart: Date | null;

  @Column({ name: 'period_end', type: 'date', nullable: true })
  periodEnd: Date | null;

  @Column({ default: true })
  isActive: boolean;
}
