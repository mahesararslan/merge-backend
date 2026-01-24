import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { CalendarService } from './calendar.service';
import { CalendarController } from './calendar.controller';
import { CalendarProcessor } from './calendar.processor';
import { CalendarEvent } from '../entities/calendar-event.entity';
import { User } from '../entities/user.entity';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CalendarEvent, User]),
    BullModule.registerQueue({ name: 'calendar' }),
    NotificationModule,
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarProcessor],
  exports: [CalendarService],
})
export class CalendarModule {}
