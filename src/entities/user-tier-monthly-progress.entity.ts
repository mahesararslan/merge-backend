import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { ChallengeType } from './challenge-definition.entity';

// Per-user, per-tier, per-month counter of completed challenges. Drives the
// monthly badge award threshold (5 daily / 4 weekly / 2 monthly completions).
// One row per (user, tier, periodMonth). Created lazily on first completion
// of that tier in that month.
@Entity('user_tier_monthly_progress')
@Index('unique_user_tier_month', ['user', 'tier', 'periodMonth'], { unique: true })
export class UserTierMonthlyProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 20 })
  tier: ChallengeType;

  // First day of the calendar month this counter belongs to (e.g. 2026-11-01).
  @Column({ name: 'period_month', type: 'date' })
  periodMonth: Date;

  @Column({ name: 'completed_count', default: 0 })
  completedCount: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
