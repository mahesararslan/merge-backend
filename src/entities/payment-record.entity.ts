import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { UserSubscription } from './user-subscription.entity';

export enum PaymentStatus {
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

@Entity('payment_records')
export class PaymentRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @ManyToOne(() => UserSubscription, { nullable: true, onDelete: 'SET NULL' })
  subscription: UserSubscription | null;

  @Column({ type: 'numeric' })
  amountPkr: number;

  @Column({ type: 'enum', enum: PaymentStatus })
  status: PaymentStatus;

  @Column({ nullable: true })
  lsOrderId: string;

  @Column({ nullable: true })
  invoiceUrl: string;

  @Column({ type: 'timestamp', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
