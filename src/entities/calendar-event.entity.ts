
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
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
