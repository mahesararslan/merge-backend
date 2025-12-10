import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
} from 'typeorm';
import { Quiz } from './quiz.entity';
import { User } from './user.entity';

@Entity('quiz_attempts')
export class QuizAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Quiz)
  quiz: Quiz;

  @ManyToOne(() => User)
  user: User;

  @Column({ nullable: true })
  submittedAt: Date; 

  @Column('simple-json', { nullable: true })
  answers: any;

  @Column({ type: 'float', nullable: true })
  score: number;

}
