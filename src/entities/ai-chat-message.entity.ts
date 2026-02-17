import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { AiConversation } from './ai-conversation.entity';

export enum MessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

@Entity('ai_chat_messages')
@Index(['conversation', 'createdAt'])
export class AiChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => AiConversation, (conversation) => conversation.messages, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  conversation: AiConversation;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user: User;

  @Column({
    type: 'enum',
    enum: MessageRole,
  })
  role: MessageRole;

  @Column('text')
  content: string;

  @Column({ type: 'uuid', nullable: true })
  contextFileId: string | null;

  @Column('jsonb', { nullable: true })
  sources: any; // Array of source chunks with metadata (assistant messages only)

  @Column({ type: 'int', nullable: true })
  chunksRetrieved: number | null; // Assistant messages only

  @Column({ type: 'float', nullable: true })
  processingTimeMs: number | null; // Assistant messages only

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
