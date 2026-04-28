import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Badge } from './badge.entity';

// One row per (user, badge, calendar month). A user can earn the same
// badge again in a different month — so the unique constraint includes
// period_month rather than just (user, badge).
@Entity('user_badges')
@Index('user_badges_user_badge_month_unique', ['user', 'badge', 'periodMonth'], { unique: true })
export class UserBadge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @ManyToOne(() => Badge, { eager: true })
  badge: Badge;

  @Column({ type: 'timestamp' })
  earnedAt: Date;

  // The first day of the month this badge was earned in (e.g. 2026-11-01).
  // Lets users earn the same badge again next month.
  @Column({ name: 'period_month', type: 'date' })
  periodMonth: Date;

  @Column({ nullable: true })
  lsDiscountCode: string;

  @Column({ default: false })
  isRedeemed: boolean;

  @CreateDateColumn()
  createdAt: Date;
}