import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FolderService } from './folder.service';
import { FolderController } from './folder.controller';
import { Folder } from '../entities/folder.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { RoomMember } from '../entities/room-member.entity';
import { Note } from '../entities/note.entity';
import { File } from '../entities/file.entity';
import { FileModule } from '../file/file.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Folder,
      User,
      Room,
      RoomMember,
      Note,
      File,
    ]),
    forwardRef(() => FileModule),
  ],
  controllers: [FolderController],
  providers: [FolderService],
  exports: [FolderService],
})
export class FolderModule {}