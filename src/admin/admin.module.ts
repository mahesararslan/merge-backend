import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { RoomMember } from '../entities/room-member.entity';
import { LiveSession } from '../entities/live-video-session.entity';
import { SubscriptionPlan } from '../entities/subscription-plan.entity';
import { UserSubscription } from '../entities/user-subscription.entity';
import { PaymentRecord } from '../entities/payment-record.entity';
import { Badge } from '../entities/badge.entity';
import { UserBadge } from '../entities/user-badge.entity';
import { ChallengeDefinition } from '../entities/challenge-definition.entity';
import { UserStreak } from '../entities/user-streak.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Room, RoomMember, LiveSession,
      SubscriptionPlan, UserSubscription, PaymentRecord,
      Badge, UserBadge, ChallengeDefinition, UserStreak,
    ]),
    NotificationModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
