
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

export enum TaskCategory {
  ASSIGNMENT = 'assignment',
  QUIZ = 'quiz',
  VIDEO_SESSION = 'video-session',
  PERSONAL = 'personal',
}

export enum TaskStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  OVERDUE = 'overdue',
}

@Entity('calendar_events')
@Index('idx_calendar_event_owner_deadline', ['owner', 'deadline'])
export class CalendarEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  owner: User;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column()
  deadline: Date;

  @Column({
    type: 'enum',
    enum: TaskCategory,
    default: TaskCategory.PERSONAL,
  })
  taskCategory: TaskCategory;

  @Column({
    type: 'enum',
    enum: TaskStatus,
    default: TaskStatus.PENDING,
  })
  taskStatus: TaskStatus;

  @CreateDateColumn()
  createdAt: Date;
}
