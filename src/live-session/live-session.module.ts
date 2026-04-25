import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LiveSessionService } from './live-session.service';
import { LiveSessionController } from './live-session.controller';
import { LiveSession } from '../entities/live-video-session.entity';
import { SessionAttendee } from '../entities/live-video-sesssion-attendee.entity';
import { FocusReport } from '../entities/focus-report.entity';
import { LiveVideoPermissions } from '../entities/live-video-permissions.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { RoomRoleGuard } from '../auth/guards/roles/room-role.guard';
import { CalendarModule } from '../calendar/calendar.module';
import { TranscriptionModule } from '../transcription/transcription.module';
import { CanvasModule } from '../canvas/canvas.module';
import { QueueModule } from '../queue/queue.module';
import { NotificationModule } from '../notification/notification.module';
import { LiveKitModule } from '../livekit/livekit.module';
import { forwardRef } from '@nestjs/common';
import { RewardsModule } from '../rewards/rewards.module';
import { LiveSessionProcessor } from './live-session.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LiveSession,
      SessionAttendee,
      LiveVideoPermissions,
      Room,
      User,
      RoomMember,
      FocusReport,
    ]),
    CalendarModule,
    HttpModule,
    ConfigModule,
    TranscriptionModule,
    CanvasModule,
    QueueModule,
    NotificationModule,
    LiveKitModule,
    forwardRef(() => RewardsModule),
  ],
  controllers: [LiveSessionController],
  providers: [LiveSessionService, LiveSessionProcessor, RoomRoleGuard],
  exports: [LiveSessionService],
})
export class LiveSessionModule {}
