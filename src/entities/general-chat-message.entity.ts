import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
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

  @Column({ nullable: true })
  content: string;

  @Column('simple-json', { nullable: true })
  attachments: { name: string; url: string }[];

  @Column({ nullable: true })
  replyToId: string;

  @Column({ default: false })
  isEdited: boolean;

  // Soft delete for specific users (stores user IDs who deleted this message for themselves)
  @Column('simple-array', { nullable: true })
  deletedForUserIds: string[];

  // Delete for everyone functionality
  @Column({ default: false })
  isDeletedForEveryone: boolean;

  @Column({ nullable: true })
  deletedForEveryoneAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
