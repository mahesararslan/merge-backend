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
import { Folder } from './folder.entity';

@Entity('notes')
@Index('idx_note_owner_created', ['owner', 'createdAt'])
@Index('idx_note_owner_updated', ['owner', 'updatedAt'])
@Index('idx_note_owner_folder', ['owner', 'folder'])
export class Note {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  owner: User;

  @ManyToOne(() => Folder, { nullable: true })
  folder: Folder;

  @Column({ nullable: true })
  title: string;

  @Column()
  content: string; // rich text in html

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
