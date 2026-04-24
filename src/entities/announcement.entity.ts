import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';
import { Room } from './room.entity';

@Entity('announcements')
@Index('idx_announcement_room_published_created', ['room', 'isPublished', 'createdAt'])
export class Announcement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Room)
  room: Room;

  @ManyToOne(() => User)
  author: User;

  @Column()
  title: string;

  @Column()
  content: string;

  @Column({ nullable: true })
  scheduledAt: Date;

  @Column({ default: false })
  isPublished: boolean;

  @Column({ default: false })
  isEdited: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  editedAt: Date;
}
