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

  @ManyToOne(() => User, { nullable: false })
  user: User;

  @ManyToOne(() => Assignment, { nullable: false })
  assignment: Assignment;

  @Column()
  fileUrl: string;

  @Column({ type: 'timestamp' })
  submitAt: Date;

  @Column({ type: 'float', nullable: true })
  score: number | null;
}
