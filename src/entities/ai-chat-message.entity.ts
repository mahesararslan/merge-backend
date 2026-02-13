import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';

@Entity('ai_chat_messages')
@Index(['user', 'createdAt'])
export class AiChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { nullable: false })
  user: User;

  @Column('text')
  query: string;

  @Column('text')
  answer: string;

  @Column('simple-array', { nullable: true })
  roomIds: string[];

  @Column({ type: 'uuid', nullable: true })
  contextFileId: string | null;

  @Column('jsonb', { nullable: true })
  sources: any; // Array of source chunks with metadata

  @Column({ type: 'int', nullable: true })
  chunksRetrieved: number | null;

  @Column({ type: 'float', nullable: true })
  processingTimeMs: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
