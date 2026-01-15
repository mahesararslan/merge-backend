import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AnnouncementService } from './announcement.service';
import { AnnouncementController } from './announcement.controller';
import { AnnouncementProcessor } from './announcement.processor';
import { Announcement } from '../entities/announcement.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { NotificationModule } from '../notification/notification.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Announcement, Room, User, RoomMember]),
    NotificationModule,
    QueueModule,
    HttpModule,
  ],
  controllers: [AnnouncementController],
  providers: [AnnouncementService, AnnouncementProcessor],
  exports: [AnnouncementService],
})
export class AnnouncementModule {}
