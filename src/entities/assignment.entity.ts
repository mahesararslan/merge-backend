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

  @ManyToOne(() => Room, { nullable: true })
  room: Room;

  @ManyToOne(() => User)
  author: User;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  startAt: Date;

  @Column({ nullable: true })
  endAt: Date;

  @Column({ default: false })
  isTurnInLateEnabled: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
