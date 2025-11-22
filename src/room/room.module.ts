// src/room/room.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomService } from './room.service';
import { RoomController } from './room.controller';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { TagModule } from '../tag/tag.module';
import { RoomMember } from 'src/entities/room-member.entity';
import { RoomPermissions } from '../entities/room-permissions.entity';
import { File } from '../entities/file.entity';
import { Folder } from 'src/entities/folder.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Room, 
      User, 
      RoomMember, 
      RoomPermissions, 
      Folder,     
      File, 
    ]),
    TagModule,
  ],
  controllers: [RoomController],
  providers: [RoomService],
  exports: [RoomService],
})
export class RoomModule {}