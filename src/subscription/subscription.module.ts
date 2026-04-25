import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { SubscriptionService } from './subscription.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionSeedService } from './subscription.seed';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { UserSubscription } from '../entities/user-subscription.entity';
import { PaymentRecord } from '../entities/payment-record.entity';
import { UserBadge } from '../entities/user-badge.entity';
import { User } from '../entities/user.entity';
import { Badge } from '../entities/badge.entity';
import { ChallengeDefinition } from '../entities/challenge-definition.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SubscriptionPlan, UserSubscription, PaymentRecord, UserBadge, User, Badge, ChallengeDefinition]),
    NotificationModule,
    ConfigModule,
  ],
  controllers: [SubscriptionController],
  providers: [SubscriptionService, SubscriptionSeedService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
