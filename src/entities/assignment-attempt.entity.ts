import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
} from 'typeorm';
import { User } from './user.entity';
import { Assignment } from './assignment.entity';

@Entity('assignment_attempts')
export class AssignmentAttempt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  user: User;

  @ManyToOne(() => Assignment)
  assignment: Assignment;

  @Column()
  fileUrl: string;

  @Column()
  submitAt: Date;

  @Column({ type: 'float', nullable: true })
  score: number;
}
