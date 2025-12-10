// src/entities/room-permissions.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { RoomMember } from './room-member.entity';

@Entity('room_permissions')
export class RoomPermissions {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => RoomMember, (member) => member.roomPermissions, { onDelete: 'CASCADE' })
  @JoinColumn()
  member: RoomMember;

  @Column({ default: false })
  can_add_files: boolean;

  @Column({ default: false })
  can_start_session: boolean;

  @Column({ default: false })
  can_add_users: boolean;

  @Column({ default: false })
  can_post_announcements: boolean;

  @Column({ default: true })
  can_talk_in_general_chat: boolean;
}