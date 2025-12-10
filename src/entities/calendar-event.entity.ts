import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('calendar_events')
export class CalendarEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  owner: User;

  @Column()
  title: string;

  @Column({ nullable: true })
  description: string;

  @Column()
  deadline: Date;

  @CreateDateColumn()
  createdAt: Date;
}
