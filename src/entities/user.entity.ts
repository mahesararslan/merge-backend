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

export enum UserRole {
  INSTRUCTOR = 'instructor',
  STUDENT = 'student',
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
  
  @Column({ default:true })
  new_user: boolean

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.STUDENT,
  })
  role: UserRole;

  @ManyToMany(() => Tag, (tag) => tag.users, { cascade: true })
  @JoinTable({
    name: 'user_tags', // join table name
    joinColumn: { name: 'userId', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tagId', referencedColumnName: 'id' },
  })
  tags: Tag[];

  @Column({ default: false })
  googleAccount: boolean;

  @OneToOne(() => UserAuth, (auth) => auth.user, { cascade: true, eager: true })
  auth: UserAuth;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}