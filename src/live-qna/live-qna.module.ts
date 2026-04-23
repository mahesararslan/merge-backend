import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiveQnaController } from './live-qna.controller';
import { LiveQnaService } from './live-qna.service';
import { LiveQnaQuestion } from '../entities/live-qna-question.entity';
import { LiveQnaVote } from '../entities/live-qna-vote.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { LiveSession } from '../entities/live-video-session.entity';
import { RoomMember } from '../entities/room-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LiveQnaQuestion,
      LiveQnaVote,
      User,
      Room,
      LiveSession,
      RoomMember,
    ]),
  ],
  controllers: [LiveQnaController],
  providers: [LiveQnaService],
  exports: [LiveQnaService],
})
export class LiveQnaModule {}
