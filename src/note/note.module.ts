// src/note/note.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NoteService } from './note.service';
import { NoteController } from './note.controller';
import { Note } from '../entities/note.entity';
import { User } from '../entities/user.entity';
import { Folder } from '../entities/folder.entity';
import { Room } from '../entities/room.entity';
import { RoomMember } from '../entities/room-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Note,
      User,
      Folder,
      Room,          
      RoomMember,    
    ]),
  ],
  controllers: [NoteController],
  providers: [NoteService],
  exports: [NoteService],
})
export class NoteModule {}