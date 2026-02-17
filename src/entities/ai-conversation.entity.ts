import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { AiChatMessage } from './ai-chat-message.entity';

@Entity('ai_conversations')
@Index(['user', 'createdAt'])
export class AiConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'simple-array' })
  roomIds: string[];

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @OneToMany(() => AiChatMessage, (message) => message.conversation)
  messages: AiChatMessage[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
