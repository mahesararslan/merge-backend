// src/entities/session-attendee.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { LiveSession } from './live-video-session.entity';

@Entity('session_attendees')
@Unique(['session', 'user']) // One record per user per session
export class SessionAttendee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => LiveSession, (session) => session.attendees, { onDelete: 'CASCADE' })
  session: LiveSession;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ nullable: true })
  joinedAt: Date;

  @Column({ nullable: true })
  leftAt: Date;

  @Column({ type: 'float', default: 0 })
  focusScore: number; // 0-100 based on engagement metrics

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}