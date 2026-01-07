import {
  Entity,
  PrimaryGeneratedColumn,
  ManyToOne,
  Column,
  Unique,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('live_chat_messages')
@Unique(['message', 'user'])
export class LiveChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  message: string;

  @ManyToOne(() => User)
  user: User;

  @Column({ default: 0 })
  votes: number;

  @CreateDateColumn()
  createdAt: Date;
}
