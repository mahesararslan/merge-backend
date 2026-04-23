import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { LiveSession } from './live-video-session.entity';

@Entity('focus_reports')
export class FocusReport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => LiveSession, { onDelete: 'CASCADE' })
  session: LiveSession;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'float', default: 0 })
  focusScore: number; // 0-100

  @Column({ type: 'bigint' })
  totalDurationMs: number;

  @Column({ type: 'bigint' })
  focusedMs: number;

  @Column({ type: 'bigint' })
  distractedMs: number;

  @Column({ type: 'bigint' })
  noFaceMs: number;

  @Column({ type: 'bigint' })
  longestFocusedStreakMs: number;

  @Column({ type: 'bigint' })
  trackingStartedAt: number; // epoch ms

  @Column({ type: 'bigint' })
  trackingEndedAt: number; // epoch ms

  @Column({ type: 'jsonb', nullable: true })
  events: Array<{
    state: string;
    startedAt: number;
    endedAt: number | null;
    durationMs: number;
  }>;

  @CreateDateColumn()
  createdAt: Date;
}
