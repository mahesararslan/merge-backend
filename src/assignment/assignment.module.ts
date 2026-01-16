import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssignmentService } from './assignment.service';
import { AssignmentController } from './assignment.controller';
import { AssignmentProcessor } from './assignment.processor';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentAttempt } from '../entities/assignment-attempt.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { RoomRoleGuard } from 'src/auth/guards/roles/room-role.guard';
import { NotificationModule } from '../notification/notification.module';
import { QueueModule } from '../queue/queue.module';


@Module({
  imports: [
    TypeOrmModule.forFeature([
      Assignment,
      AssignmentAttempt,
      Room,
      User,
      RoomMember,
    ]),
    NotificationModule,
    QueueModule,
  ],
  controllers: [AssignmentController],
  providers: [AssignmentService, AssignmentProcessor, RoomRoleGuard],
  exports: [AssignmentService],
})
export class AssignmentModule {}
