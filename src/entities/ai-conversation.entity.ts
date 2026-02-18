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

  // Attachment fields for file-as-context feature
  @Column({ type: 'text', nullable: true })
  attachmentContext: string | null; // Flow 1: Extracted text/base64 content

  @Column({ type: 'varchar', length: 1024, nullable: true })
  attachmentUrl: string | null; // S3 URL

  @Column({
    type: 'enum',
    enum: AttachmentType,
    nullable: true,
  })
  attachmentType: AttachmentType | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  attachmentOriginalName: string | null;

  @Column({ type: 'boolean', default: false })
  attachmentInVectorDB: boolean; // Flow 2: Stored in Qdrant

  @Column({ type: 'timestamp', nullable: true })
  attachmentVectorsCleanedAt: Date | null;

  @OneToMany(() => AiChatMessage, (message) => message.conversation)
  messages: AiChatMessage[];

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
