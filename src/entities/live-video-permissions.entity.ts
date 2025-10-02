import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { RoomMember } from './room-member.entity';

@Entity('live_video_permissions')
export class LiveVideoPermissions {
  @PrimaryGeneratedColumn('uuid')
  id: string;

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

  @ManyToOne(() => RoomMember, (member) => member.liveVideoPermissions, { onDelete: 'CASCADE' })
  member: RoomMember;
}
