import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  Unique,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { ChallengeDefinition, ChallengeType } from './challenge-definition.entity';

// Re-export so any existing imports from this file still work
export { ChallengeType };

@Entity('user_challenge_progress')
@Unique(['user', 'challengeDefinition', 'periodStart'])
export class UserChallengeProgress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @ManyToOne(() => ChallengeDefinition, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn()
  challengeDefinition: ChallengeDefinition;

  @Column({ type: 'enum', enum: ChallengeType })
  challengeType: ChallengeType;

  @Column({ type: 'date' })
  periodStart: Date;

  @Column({ default: 0 })
  currentCount: number;

  @Column({ default: false })
  isCompleted: boolean;

  @Column({ type: 'timestamp', nullable: true })
  completedAt: Date | null;

  @Column({ default: 0 })
  consecutiveCount: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
