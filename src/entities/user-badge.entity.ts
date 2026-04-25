import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Badge } from './badge.entity';

@Entity('user_badges')
export class UserBadge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @ManyToOne(() => Badge, { eager: true })
  badge: Badge;

  @Column({ type: 'timestamp' })
  earnedAt: Date;

  @Column({ nullable: true })
  lsDiscountCode: string;

  @Column({ default: false })
  isRedeemed: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
