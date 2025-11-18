// src/entities/file.entity.ts
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
import { Room } from './room.entity';
import { Folder } from './folder.entity';

export enum FileType {
  DOCUMENT = 'document',
  IMAGE = 'image',
  SPREADSHEET = 'spreadsheet',
  PRESENTATION = 'presentation',
  PDF = 'pdf',
  OTHER = 'other',
}

@Entity('files')
@Index(['uploader', 'folder'])
@Index(['room', 'folder'])
export class File {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  originalName: string;

  @Column()
  fileName: string; // Stored file name

  @Column()
  filePath: string;

  @Column()
  mimeType: string;

  @Column('bigint')
  size: number; // File size in bytes

  @Column({
    type: 'enum',
    enum: FileType,
  })
  type: FileType;

  @ManyToOne(() => User)
  uploader: User;

  @ManyToOne(() => Room, { nullable: true })
  room: Room;

  @ManyToOne(() => Folder, folder => folder.files, { nullable: true })
  folder: Folder;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}