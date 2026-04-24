import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { AiConversation } from './ai-conversation.entity';
import type { AttachmentType } from './ai-conversation.entity';

/**
 * One attachment within an AI conversation. A conversation can have up
 * to 2 of these (cap enforced in the service layer). Each attachment
 * carries its own extracted text (Flow 1) or Qdrant flag (Flow 2).
 *
 * Note on `type`: we use a plain varchar rather than a Postgres enum.
 * The two entity files import each other (AiConversation has
 * `@OneToMany(() => ConversationAttachment)` and this file points back
 * via `@ManyToOne`), and at decorator-evaluation time the AttachmentType
 * enum VALUE is still undefined due to the circular module evaluation.
 * A varchar avoids needing the enum at metadata-build time. Values are
 * still validated upstream via class-validator in the DTO.
 */
@Entity('conversation_attachments')
@Index(['conversation', 'createdAt'])
export class ConversationAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => AiConversation, (c) => c.attachments, {
    onDelete: 'CASCADE',
  })
  conversation: AiConversation;

  @Column({ type: 'varchar', length: 1024 })
  url: string;

  @Column({ type: 'varchar', length: 32 })
  type: AttachmentType;

  @Column({ type: 'varchar', length: 255 })
  originalName: string;

  @Column({
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v == null ? null : Number(v)),
    },
  })
  fileSize: number | null;

  // Flow 1 — full extracted text injected into every prompt. Null if
  // the file went Flow 2 (chunked into Qdrant instead).
  @Column({ type: 'text', nullable: true })
  context: string | null;

  // Flow 2 flag — chunks live in Qdrant keyed by conversation id.
  @Column({ type: 'boolean', default: false })
  inVectorDB: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
