// src/folder/folder.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FolderService } from './folder.service';
import { FolderController } from './folder.controller';
import { Folder } from '../entities/folder.entity';
import { User } from '../entities/user.entity';
import { Note } from '../entities/note.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Folder,
      User,
      Note,
    ]),
  ],
  controllers: [FolderController],
  providers: [FolderService],
  exports: [FolderService],
})
export class FolderModule {}