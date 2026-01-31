import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuizService } from './quiz.service';
import { QuizController } from './quiz.controller';
import { Quiz } from '../entities/quiz.entity';
import { QuizQuestion } from '../entities/quiz-question.entity';
import { QuizAttempt } from '../entities/quiz-attempt.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { RoomRoleGuard } from 'src/auth/guards/roles/room-role.guard';
import { NotificationModule } from '../notification/notification.module';
import { QueueModule } from 'src/queue/queue.module';
import { CalendarModule } from '../calendar/calendar.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Quiz,
      QuizQuestion,
      QuizAttempt,
      Room,
      User,
      RoomMember,
    ]),
    QueueModule,
    NotificationModule,
    CalendarModule,
  ],
  controllers: [QuizController],
  providers: [QuizService, RoomRoleGuard],
  exports: [QuizService],
})
export class QuizModule {}
