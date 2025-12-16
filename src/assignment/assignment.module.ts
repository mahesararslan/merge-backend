import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssignmentService } from './assignment.service';
import { AssignmentController } from './assignment.controller';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentAttempt } from '../entities/assignment-attempt.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { RoomRoleGuard } from '../room/guards/room-role.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Assignment,
      AssignmentAttempt,
      Room,
      User,
      RoomMember,
    ]),
  ],
  controllers: [AssignmentController],
  providers: [AssignmentService, RoomRoleGuard],
  exports: [AssignmentService],
})
export class AssignmentModule {}
