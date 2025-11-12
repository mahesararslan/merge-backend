// src/announcement/announcement.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnouncementService } from './announcement.service';
import { AnnouncementController } from './announcement.controller';
import { Announcement } from '../entities/announcement.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { RoomPermissions } from '../entities/room-permissions.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Announcement,
      Room,
      User,
      RoomMember,
      RoomPermissions,
    ]),
  ],
  controllers: [AnnouncementController],
  providers: [AnnouncementService],
  exports: [AnnouncementService],
})
export class AnnouncementModule {}