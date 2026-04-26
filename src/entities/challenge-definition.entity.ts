import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { PlanTier } from './subscription-plan.entity';

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

  // Optional scheduling window. When NULL, the challenge is "evergreen" and
  // is selected by the sliding-window scheduler. When set, the challenge is
  // a calendar event that only appears between periodStart (inclusive) and
  // periodEnd (exclusive). Admin-created challenges always have these set;
  // seeded challenges leave them NULL.
  @Column({ name: 'period_start', type: 'date', nullable: true })
  periodStart: Date | null;

  @Column({ name: 'period_end', type: 'date', nullable: true })
  periodEnd: Date | null;

  @Column({ default: true })
  isActive: boolean;
}
