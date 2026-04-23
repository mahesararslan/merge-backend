// src/entities/live-session.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';

import { User } from './user.entity';
import { Room } from './room.entity';
import { SessionAttendee } from './live-video-sesssion-attendee.entity';

export enum SessionStatus {
  SCHEDULED = 'scheduled',
  LIVE = 'live',
  ENDED = 'ended',
  CANCELLED = 'cancelled',
}

@Entity('live_sessions')
export class LiveSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  room: Room;

  @ManyToOne(() => User)
  host: User;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'acting_host_id' })
  actingHost: User | null;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column({ type: 'enum', enum: SessionStatus, default: SessionStatus.SCHEDULED })
  status: SessionStatus;

  @Column({ nullable: true })
  scheduledAt: Date;

  @Column({ nullable: true })
  startedAt: Date;

  @Column({ nullable: true })
  endedAt: Date;

  @Column({ nullable: true })
  durationMinutes: number; // Calculated when session ends

  @Column({ nullable: true })
  maxAttendees: number; // Optional limit

  @Column({ nullable: true })
  summaryText: string; // AI-generated summary (Gemini structured notes)

  @Column({ nullable: true })
  summaryPdfUrl: string; // S3 public URL of the generated notes PDF

  @OneToMany(() => SessionAttendee, (attendee) => attendee.session)
  attendees: SessionAttendee[];

  @CreateDateColumn()
  createdAt: Date;
}