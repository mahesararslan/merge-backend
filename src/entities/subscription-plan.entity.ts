import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum PlanTier {
  FREE = 'free',
  BASIC = 'basic',
  PRO = 'pro',
  MAX = 'max',
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

  @Column()
  roomLimit: number;

  @Column()
  noteLimit: number;

  @Column({ default: false })
  hasLectureSummary: boolean;

  @Column({ default: false })
  hasFocusTracker: boolean;

  @Column({ default: true })
  isActive: boolean;
}
