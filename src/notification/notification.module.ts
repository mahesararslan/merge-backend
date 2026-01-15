import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationService } from './notification.service';
import { Notification } from '../entities/notification.entity';
import { FcmToken } from '../entities/fcm-token.entity';
import { RoomMember } from '../entities/room-member.entity';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, FcmToken, RoomMember]),
    FirebaseModule,
  ],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
