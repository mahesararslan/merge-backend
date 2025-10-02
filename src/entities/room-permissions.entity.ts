import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { RoomMember } from './room-member.entity';

@Entity('room_permissions')
export class RoomPermissions {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RoomMember, (member) => member.roomPermissions, { onDelete: 'CASCADE' })
  member: RoomMember;

  @Column({ default: false })
  can_add_files: boolean;

  @Column({ default: false })
  can_start_session: boolean;

  @Column({ default: false })
  can_add_users: boolean;

  @Column({ default: false })
  can_post_announcements: boolean;

  @Column({ default: false })
  can_talk_in_general_chat: boolean;
}
