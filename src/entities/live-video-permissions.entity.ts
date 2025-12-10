// src/entities/live-video-permissions.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, OneToOne, JoinColumn } from 'typeorm';
import { RoomMember } from './room-member.entity';

@Entity('live_video_permissions')
export class LiveVideoPermissions {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @OneToOne(() => RoomMember, (member) => member.liveVideoPermissions, { onDelete: 'CASCADE' })
  @JoinColumn()
  member: RoomMember;

  @Column({ default: false })
  can_ask_question: boolean;

  @Column({ default: false })
  can_edit_canvas: boolean;

  @Column({ default: false })
  can_share_screen: boolean;

  @Column({ default: false })
  can_open_mic: boolean;

  @Column({ default: false })
  can_open_web_cam: boolean;
}