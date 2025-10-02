import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';

@Entity('messages')
export class Message {
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

  @Column({ default: 'chat' })
  type: string; // chat | question | system

  @Column({ nullable: true })
  replyToId: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ nullable: true })
  editedAt: Date;
}
