import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToOne,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { SubscriptionPlan } from './subscription-plan.entity';

export enum SubscriptionStatus {
  ACTIVE = 'active',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  PAST_DUE = 'past_due',
  TRIALING = 'trialing',
}

@Entity('user_subscriptions')
export class UserSubscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user: User;

  @ManyToOne(() => SubscriptionPlan, { eager: true })
  plan: SubscriptionPlan;

  @Column({ type: 'enum', enum: SubscriptionStatus, default: SubscriptionStatus.ACTIVE })
  status: SubscriptionStatus;

  @Column({ nullable: true, unique: true })
  lsSubscriptionId: string;

  @Column({ nullable: true })
  lsCustomerId: string;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodStart: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ default: 0 })
  appliedDiscountPercentage: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
