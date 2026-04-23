import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('messages')
@Index('idx_messages_sender_recipient_created', ['sender', 'recipient', 'createdAt'])
@Index('idx_messages_recipient_sender_created', ['recipient', 'sender', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  sender: User;

  @ManyToOne(() => User)
  recipient: User;

  @Column({ nullable: true })
  content: string;

  @Column({ nullable: true })
  attachmentURL: string;

  @Column({ nullable: true })
  replyToId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Soft delete for specific users (stores user IDs who deleted this message for themselves)
  @Column('simple-array', { nullable: true })
  deletedForUserIds: string[];

  // Delete for everyone functionality
  @Column({ default: false })
  isDeletedForEveryone: boolean;

  @Column({ nullable: true })
  deletedForEveryoneAt: Date;

  // Track if message was edited
  @Column({ default: false })
  isEdited: boolean;
}
