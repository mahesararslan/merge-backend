import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// Defined here (not in user-challenge-progress.entity.ts) to avoid circular import
export enum ChallengeType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export enum ChallengeAction {
  CALENDAR_TASK_COMPLETED = 'calendar_task_completed',
  NOTE_CREATED = 'note_created',
  ROOM_CREATED = 'room_created',
  ROOM_JOINED = 'room_joined',
  LIVE_SESSION_ATTENDED = 'live_session_attended',
  QUIZ_COMPLETED = 'quiz_completed',
  ASSIGNMENT_SUBMITTED = 'assignment_submitted',
  FOCUS_SCORE = 'focus_score',
}

@Entity('challenge_definitions')
export class ChallengeDefinition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  description: string;

  @Column()
  icon: string;

  @Column({ type: 'enum', enum: ChallengeType })
  tier: ChallengeType;

  @Column({ type: 'enum', enum: ChallengeAction })
  actionType: ChallengeAction;

  @Column()
  target: number;

  @Column({ default: 0 })
  points: number;

  @Column({ default: true })
  isActive: boolean;
}
