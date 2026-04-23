import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiveKitService } from './livekit.service';
import { LiveKitController } from './livekit.controller';
import { Room } from '../entities/room.entity';
import { RoomMember } from '../entities/room-member.entity';
import { LiveVideoPermissions } from '../entities/live-video-permissions.entity';
import { LiveSession } from '../entities/live-video-session.entity';
import { User } from '../entities/user.entity';
import { RoomRoleGuard } from '../auth/guards/roles/room-role.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Room,
      RoomMember,
      LiveVideoPermissions,
      LiveSession,
      User,
    ]),
  ],
  controllers: [LiveKitController],
  providers: [LiveKitService, RoomRoleGuard],
  exports: [LiveKitService],
})
export class LiveKitModule {}
