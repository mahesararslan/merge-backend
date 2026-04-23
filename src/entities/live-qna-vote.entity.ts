import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
  Unique,
  RelationId,
} from 'typeorm';
import { LiveQnaQuestion } from './live-qna-question.entity';
import { User } from './user.entity';

@Entity('live_qna_votes')
@Unique('live_qna_vote_question_user_unique', ['question', 'user'])
export class LiveQnaVote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => LiveQnaQuestion, (question) => question.votes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'question_id' })
  question: LiveQnaQuestion;

  @RelationId((vote: LiveQnaVote) => vote.question)
  questionId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @RelationId((vote: LiveQnaVote) => vote.user)
  userId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
