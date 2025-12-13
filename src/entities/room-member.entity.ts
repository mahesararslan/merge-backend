// src/entities/room-member.entity.ts
import { 
  Entity, 
  PrimaryGeneratedColumn, 
  ManyToOne, 
  OneToOne,
  Column,
  CreateDateColumn,
  UpdateDateColumn 
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';
import { LiveVideoPermissions } from './live-video-permissions.entity';

export enum RoomMemberRole {
  MEMBER = 'member',
  MODERATOR = 'moderator',
  ADMIN = 'admin', // Pseudo-role for decorator only, not stored in DB
}

@Entity('room_members')
export class RoomMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room, (room) => room.members, { onDelete: 'CASCADE' })
  room: Room;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({
    type: 'enum',
    enum: RoomMemberRole,
    default: RoomMemberRole.MEMBER,
  })
  role: RoomMemberRole;

  @OneToOne(() => LiveVideoPermissions, (perm) => perm.member)
  liveVideoPermissions: LiveVideoPermissions;

  @CreateDateColumn()
  joinedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}