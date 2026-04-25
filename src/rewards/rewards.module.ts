import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { RewardsService } from './rewards.service';
import { RewardsController } from './rewards.controller';
import { UserStreak } from '../entities/user-streak.entity';
import { Badge } from '../entities/badge.entity';
import { UserBadge } from '../entities/user-badge.entity';
import { UserChallengeProgress } from '../entities/user-challenge-progress.entity';
import { ChallengeDefinition } from '../entities/challenge-definition.entity';
import { User } from '../entities/user.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserStreak, Badge, UserBadge, UserChallengeProgress, ChallengeDefinition, User]),
    NotificationModule,
    ConfigModule,
  ],
  controllers: [RewardsController],
  providers: [RewardsService],
  exports: [RewardsService],
})
export class RewardsModule {}
