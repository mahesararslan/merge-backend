import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';

@Entity('folders')
export class Folder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToOne(() => User)
  owner: User;

  @ManyToOne(() => Room, { nullable: true })
  room: Room;

  @ManyToOne(() => Folder, { nullable: true })
  parent: Folder;

  @OneToMany(() => Folder, (folder) => folder.parent)
  children: Folder[];

  @CreateDateColumn()
  createdAt: Date;
}
