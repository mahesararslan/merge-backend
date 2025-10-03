// src/entities/room-member.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  ManyToOne, 
  OneToMany,
  CreateDateColumn,
  UpdateDateColumn 
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';
import { RoomPermissions } from './room-permissions.entity';
import { LiveVideoPermissions } from './live-video-permissions.entity';

@Entity('room_members')
export class RoomMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room, (room) => room.members, { onDelete: 'CASCADE' })
  room: Room;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @OneToMany(() => RoomPermissions, (perm) => perm.member)
  roomPermissions: RoomPermissions[];

  @OneToMany(() => LiveVideoPermissions, (perm) => perm.member)
  liveVideoPermissions: LiveVideoPermissions[];

  @CreateDateColumn()
  joinedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}