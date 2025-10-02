import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToMany,
  Unique,
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';

@Entity('tags')
@Unique(['name'])
export class Tag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @ManyToMany(() => User, (user) => user.tags)
  users: User[];

  @ManyToMany(() => Room, (room) => room.tags)
  rooms: Room[];
}
