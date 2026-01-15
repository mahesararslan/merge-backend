import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity';

@Entity('fcm_tokens')
@Index(['user', 'token'], { unique: true })
export class FcmToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  token: string;

  @Column({ nullable: true })
  deviceType: string; // 'web', 'android', 'ios'

  @Column({ nullable: true })
  deviceId: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date;
}
