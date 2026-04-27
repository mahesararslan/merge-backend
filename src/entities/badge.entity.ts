import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum BadgeTier {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

@Entity('badges')
export class Badge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column()
  description: string;

  @Column()
  icon: string;

  @Column({ type: 'enum', enum: BadgeTier })
  tier: BadgeTier;

  @Column()
  discountPercentage: number;

  // How many challenge completions in this tier (within a calendar month)
  // a user needs to earn this badge. Resets at the start of every month.
  @Column({ name: 'required_count', default: 5 })
  requiredCount: number;

  @Column({ default: true })
  isActive: boolean;
}
