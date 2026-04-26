import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToMany,
  JoinTable,
  OneToOne,
} from 'typeorm';
import { Tag } from './tag.entity';
import { UserAuth } from './user-auth.entity';
import { PlanTier } from './subscription-plan.entity';

export enum UserRole {
  INSTRUCTOR = 'instructor',
  STUDENT = 'student',
  SUPER_ADMIN = 'super_admin',
}

export enum NotificationStatus {
  ALLOWED = 'allowed',
  DENIED = 'denied',
  DEFAULT = 'default',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  password: string;

  @Column({ nullable: true })
  image: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column({ default: true })
  new_user: boolean;

  @Column({
    type: 'enum',
    enum: UserRole,
    nullable: true,
  })
  role: UserRole | null;

  @ManyToMany(() => Tag, (tag) => tag.users, { cascade: true })
  @JoinTable({
    name: 'user_tags', // join table name
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tagId', referencedColumnName: 'id' },
  })
  tags: Tag[];

  @Column({ default: false })
  googleAccount: boolean;

  @Column({
    
    type: 'enum',
    enum: NotificationStatus,
    default: NotificationStatus.DEFAULT,
  })
  notificationStatus: NotificationStatus;

  @Column({ type: 'enum', enum: PlanTier, default: PlanTier.FREE })
  subscriptionTier: PlanTier;

  @OneToOne(() => UserAuth, (auth) => auth.user, { cascade: true, eager: true })
  auth: UserAuth;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @Column({ name: 'suspended_reason', type: 'text', nullable: true })
  suspendedReason: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
