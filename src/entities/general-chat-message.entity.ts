import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';

@Entity('general_chat_messages')
export class GeneralChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room)
  room: Room;

  @ManyToOne(() => User)
  author: User;

  @Column()
  content: string;

  @Column({ nullable: true })
  attachmentURL: string;

  @Column({ nullable: true })
  replyToId: string;

  @CreateDateColumn()
  createdAt: Date;

}
