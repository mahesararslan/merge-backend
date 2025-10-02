import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';

@Entity('quizzes')
export class Quiz {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room)
  room: Room;

  @ManyToOne(() => User)
  author: User;

  @Column()
  title: string;

  @Column({ nullable: true })
  timeLimitMin: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  startAt: Date;

  @Column({ nullable: true })
  endAt: Date;
}
