import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  JoinColumn,
  RelationId,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';
import { LiveSession } from './live-video-session.entity';
import { LiveQnaVote } from './live-qna-vote.entity';

export enum LiveQnaQuestionStatus {
  OPEN = 'open',
  ANSWERED = 'answered',
}

@Entity('live_qna_questions')
@Index('idx_live_qna_question_room_session_votes_created', ['room', 'session', 'votesCount', 'createdAt'])
export class LiveQnaQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'room_id' })
  room: Room;

  @RelationId((question: LiveQnaQuestion) => question.room)
  roomId: string;

  @ManyToOne(() => LiveSession, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'session_id' })
  session: LiveSession;

  @RelationId((question: LiveQnaQuestion) => question.session)
  sessionId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: User;

  @RelationId((question: LiveQnaQuestion) => question.author)
  authorId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({
    type: 'enum',
    enum: LiveQnaQuestionStatus,
    default: LiveQnaQuestionStatus.OPEN,
  })
  status: LiveQnaQuestionStatus;

  @Column({ name: 'votes_count', default: 0 })
  votesCount: number;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'answered_by_id' })
  answeredBy?: User | null;

  @RelationId((question: LiveQnaQuestion) => question.answeredBy)
  answeredById?: string | null;

  @Column({
    name: 'answered_at',
    type: 'timestamptz',
    nullable: true,
  })
  answeredAt?: Date | null;

  @Column({ name: 'ai_answer', type: 'text', nullable: true })
  aiAnswer: string | null;

  @Column({ name: 'ai_answer_sources', type: 'jsonb', nullable: true })
  aiAnswerSources: string[] | null;

  @Column({ name: 'ai_answered_at', type: 'timestamptz', nullable: true })
  aiAnsweredAt: Date | null;

  @OneToMany(() => LiveQnaVote, (vote: LiveQnaVote) => vote.question)
  votes: LiveQnaVote[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
