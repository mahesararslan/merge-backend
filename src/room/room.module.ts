// src/room/room.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoomService } from './room.service';
import { RoomController } from './room.controller';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { TagModule } from '../tag/tag.module';
import { RoomMember } from 'src/entities/room-member.entity';
import { File } from '../entities/file.entity';
import { Folder } from 'src/entities/folder.entity';
import { RoomRoleGuard } from 'src/auth/guards/roles/room-role.guard';
import { FolderModule } from '../folder/folder.module';
import { FileModule } from '../file/file.module';
import { Note } from '../entities/note.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Room, 
      User, 
      RoomMember, 
      Folder,     
      File,
      Note,
    ]),
    TagModule,
    forwardRef(() => FolderModule),
    forwardRef(() => FileModule),
  ],
  controllers: [RoomController],
  providers: [RoomService, RoomRoleGuard],
  exports: [RoomService, RoomRoleGuard],
})
export class RoomModule {}