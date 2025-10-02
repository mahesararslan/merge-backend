import { Entity, PrimaryGeneratedColumn, ManyToOne, OneToMany } from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';
import { RoomPermissions } from './room-permissions.entity';
import { LiveVideoPermissions } from './live-video-permissions.entity';

@Entity('room_members')
export class RoomMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room)
  room: Room;

  @ManyToOne(() => User)
  user: User;

  @OneToMany(() => RoomPermissions, (perm) => perm.member)
  roomPermissions: RoomPermissions[];

  @OneToMany(() => LiveVideoPermissions, (perm) => perm.member)
  liveVideoPermissions: LiveVideoPermissions[];
}
