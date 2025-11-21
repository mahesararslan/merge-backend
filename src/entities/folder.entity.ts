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
import { Room } from './room.entity';
import { Note } from './note.entity';
import { File } from './file.entity';

export enum FolderType {
  NOTES = 'notes',
  ROOM = 'room',
}

@Entity('folders')
@Index(['owner', 'room', 'parentFolder', 'type'])
export class Folder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({
    type: 'enum',
    enum: FolderType,
  })
  type: FolderType;

  @ManyToOne(() => User)
  owner: User;

  @ManyToOne(() => Room, { nullable: true })
  room: Room;

  // Self-referencing for nested folders
  @ManyToOne(() => Folder, folder => folder.subfolders, { nullable: true })
  parentFolder: Folder;

  @OneToMany(() => Folder, folder => folder.parentFolder)
  subfolders: Folder[];

  @OneToMany(() => Note, note => note.folder)
  notes: Note[];

  @OneToMany(() => File, file => file.folder)
  files: File[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}