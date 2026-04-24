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
import { ConversationAttachment } from './conversation-attachment.entity';

export enum AttachmentType {
  IMAGE = 'image',
  PDF = 'pdf',
  DOCX = 'docx',
  PPTX = 'pptx',
  TXT = 'txt',
}

@Entity('ai_conversations')
@Index(['user', 'createdAt'])
export class AiConversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'text', nullable: true })
  summary: string | null;

  // Legacy single-attachment columns. Kept for backwards compat with
  // existing conversations — new code writes to `attachments` (below).
  // When reading, if `attachments` is empty and these are populated,
  // the legacy values are treated as a single synthetic attachment.
  @Column({ type: 'text', nullable: true })
  attachmentContext: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  attachmentUrl: string | null;

  @Column({
    type: 'enum',
    enum: AttachmentType,
    nullable: true,
  })
  attachmentType: AttachmentType | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  attachmentOriginalName: string | null;

  @Column({ type: 'boolean', default: false })
  attachmentInVectorDB: boolean;

  @Column({ type: 'timestamp', nullable: true })
  attachmentVectorsCleanedAt: Date | null;

  // Current multi-file attachments — capped at 2 in the service layer.
  @OneToMany(() => ConversationAttachment, (a) => a.conversation, {
    cascade: true,
  })
  attachments: ConversationAttachment[];

  @OneToMany(() => AiChatMessage, (message) => message.conversation)
  messages: AiChatMessage[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
