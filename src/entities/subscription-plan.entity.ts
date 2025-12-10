// src/entities/subscription-plan.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PlanType {
  FREE = 'free',
  BASIC = 'basic',
  PRO = 'pro',
}

@Entity('subscription_plans')
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'enum', enum: PlanType })
  type: PlanType;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceMonthly: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  priceYearly: number;

  @Column('simple-json')
  features: {
    maxRooms: number;
    maxMembersPerRoom: number;
    maxStorageGB: number;
    maxSessionDurationMinutes: number;
    maxAttendeesPerSession: number;
    maxQuizzesPerRoom: number;
    transcriptionEnabled: boolean;
    aiSummaryEnabled: boolean;
  };

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
