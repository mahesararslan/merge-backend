// src/file/file.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileService } from './file.service';
import { FileController } from './file.controller';
import { S3Service } from './s3.service';
import { File } from '../entities/file.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { Folder } from '../entities/folder.entity';
import { RoomMember } from '../entities/room-member.entity';
import { Assignment } from '../entities/assignment.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      File,
      User,
      Room,
      Folder,
      RoomMember,
      Assignment,
    ]),
  ],
  controllers: [FileController],
  providers: [FileService, S3Service],
  exports: [FileService, S3Service],
})
export class FileModule {}