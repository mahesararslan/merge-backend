import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
} from 'typeorm';
import { Quiz } from './quiz.entity';

@Entity('quiz_questions')
export class QuizQuestion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Quiz)
  quiz: Quiz;

  @Column()
  text: string;

  @Column('simple-json')
  options: any; // store options array as JSON

  @Column({ default: 1 })
  points: number;
}
