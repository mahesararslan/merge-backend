import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { NotificationService } from './notification.service';
import { Notification } from '../entities/notification.entity';
import { FcmToken } from '../entities/fcm-token.entity';
import { RoomMember } from '../entities/room-member.entity';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, FcmToken, RoomMember]),
    FirebaseModule,
    HttpModule,
    ConfigModule,
  ],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
