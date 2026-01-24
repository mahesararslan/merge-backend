import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CalendarEvent } from '../entities/calendar-event.entity';
import { NotificationService } from '../notification/notification.service';

@Processor('calendar')
@Injectable()
export class CalendarProcessor {
  private readonly logger = new Logger(CalendarProcessor.name);

  constructor(
    @InjectRepository(CalendarEvent)
    private calendarEventRepository: Repository<CalendarEvent>,
    private notificationService: NotificationService,
  ) {}

  @Process('notify-24hr-before-deadline')
  async handleNotify24hrBeforeDeadline(job: Job) {
    const { eventId } = job.data;
    this.logger.log(`Processing 24hr-before-deadline notification for calendar event: ${eventId}`);
    try {
      await this.notificationService.sendCalendarEventReminder(eventId, '24hr');
      this.logger.log(`Sent 24hr-before-deadline notification for calendar event: ${eventId}`);
    } catch (error) {
      this.logger.error(`Failed to send 24hr-before-deadline notification: ${error.message}`);
    }
  }

  @Process('notify-5min-before-deadline')
  async handleNotify5MinBeforeDeadline(job: Job) {
    const { eventId } = job.data;
    this.logger.log(`Processing 5min-before-deadline notification for calendar event: ${eventId}`);
    try {
      await this.notificationService.sendCalendarEventReminder(eventId, '5min');
      this.logger.log(`Sent 5min-before-deadline notification for calendar event: ${eventId}`);
    } catch (error) {
      this.logger.error(`Failed to send 5min-before-deadline notification: ${error.message}`);
    }
  }
}
