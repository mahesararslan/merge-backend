// src/entities/live-session.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
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
  summaryFileUrl: string; // AI-generated summary PDF

  @OneToMany(() => SessionAttendee, (attendee) => attendee.session)
  attendees: SessionAttendee[];

  @CreateDateColumn()
  createdAt: Date;
}