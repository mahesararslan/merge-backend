import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('files')
export class File {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  uploader: User;

  @Column()
  filename: string;

  @Column()
  url: string;

  @Column({ nullable: true })
  type: string;

  @Column({ nullable: true })
  size: number;

  @CreateDateColumn()
  createdAt: Date;
}
