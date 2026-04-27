import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum PlanTier {
  // Legacy tiers — kept for back-compat with existing user records
  FREE = 'free',
  BASIC = 'basic',
  PRO = 'pro',
  MAX = 'max',
  // New role-specific tiers
  STUDENT_FREE = 'student_free',
  STUDENT_PLUS = 'student_plus',
  INSTRUCTOR_STARTER = 'instructor_starter',
  INSTRUCTOR_EDUCATOR = 'instructor_educator',
  INSTRUCTOR_PRO = 'instructor_pro',
}

export enum PlanRole {
  STUDENT = 'student',
  INSTRUCTOR = 'instructor',
  ALL = 'all',
}

@Entity('subscription_plans')
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: PlanTier, unique: true })
  name: PlanTier;

  @Column()
  displayName: string;

  @Column({ type: 'numeric' })
  priceMonthly: number;

  @Column({ default: 'PKR' })
  currency: string;

  @Column({ nullable: true })
  lsVariantId: string;

  @Column({ type: 'simple-json' })
  features: string[];

  @Column({ type: 'enum', enum: PlanRole, default: PlanRole.ALL })
  targetRole: PlanRole;

  @Column()
  roomLimit: number;

  @Column()
  noteLimit: number;

  // -1 = unlimited. Per-room cap on student members for rooms owned by this plan tier.
  @Column({ default: -1 })
  studentsPerRoom: number;

  @Column({ default: false })
  hasLectureSummary: boolean;

  @Column({ default: false })
  hasFocusTracker: boolean;

  @Column({ default: false })
  hasAiAssistant: boolean;

  @Column({ default: false })
  hasQaBot: boolean;

  @Column({ default: true })
  isActive: boolean;
}
