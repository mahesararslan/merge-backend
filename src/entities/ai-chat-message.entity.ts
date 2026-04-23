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

  // Attachment metadata for user messages that carried a file upload.
  // Kept at message level (separate from conversation.attachmentUrl) so
  // the UI can show the file pill on the specific bubble that uploaded it.
  @Column({ type: 'varchar', length: 255, nullable: true })
  attachmentOriginalName: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  attachmentType: string | null;

  @Column({ type: 'bigint', nullable: true, transformer: {
    to: (v: number | null) => v,
    from: (v: string | null) => (v == null ? null : Number(v)),
  }})
  attachmentFileSize: number | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  attachmentUrl: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
