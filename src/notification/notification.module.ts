// src/notification/notification.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FcmService } from './fcm.service';
import firebaseConfig from '../config/firebase.config';

@Global()
@Module({
  imports: [ConfigModule.forFeature(firebaseConfig)],
  providers: [FcmService],
  exports: [FcmService],
})
export class NotificationModule {}