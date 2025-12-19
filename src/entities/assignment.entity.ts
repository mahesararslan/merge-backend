import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';

@Entity('assignments')
export class Assignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room, { nullable: false })
  room: Room;

  @ManyToOne(() => User, { nullable: false })
  author: User;

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column()
  assignmentUrl: string;

  @Column({ type: 'float' })
  totalScore: number; 

  @Column({ type: 'timestamp', nullable: true })
  startAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  endAt: Date | null;

  @Column({ default: false })
  isTurnInLateEnabled: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
