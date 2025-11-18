// src/note/note.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NoteService } from './note.service';
import { NoteController } from './note.controller';
import { Note } from '../entities/note.entity';
import { User } from '../entities/user.entity';
import { Folder } from '../entities/folder.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Note,
      User,
      Folder,
    ]),
  ],
  controllers: [NoteController],
  providers: [NoteService],
  exports: [NoteService],
})
export class NoteModule {}