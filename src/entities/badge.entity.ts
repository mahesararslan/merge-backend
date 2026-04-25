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

  @Column({ default: true })
  isActive: boolean;
}
