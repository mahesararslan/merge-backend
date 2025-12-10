// src/entities/notification.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';



export enum NotificationPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

@Entity('notifications')
@Index(['user', 'isRead'])
@Index(['user', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  content: string;

  @Column({ default: false })
  isRead: boolean;

  @Column('simple-json', { nullable: true })
  metadata: {
    roomId?: string;
    roomTitle?: string;
    sessionId?: string;
    quizId?: string;
    fileId?: string;
    senderId?: string;
    senderName?: string;
    actionUrl?: string;
    [key: string]: any;
  };


  @Column({ nullable: true })
  expiresAt: Date; // Auto-delete after this date

  @Column({ default: false })
  pushSent: boolean;

  @CreateDateColumn()
  createdAt: Date;
}