import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiveSession, SessionStatus } from '../entities/live-video-session.entity';
import { NotificationService } from '../notification/notification.service';

@Processor('live-sessions')
@Injectable()
export class LiveSessionProcessor {
  private readonly logger = new Logger(LiveSessionProcessor.name);

  constructor(
    @InjectRepository(LiveSession)
    private readonly sessionRepository: Repository<LiveSession>,
    private readonly notificationService: NotificationService,
  ) {}

  @Process('send-5min-reminder')
  async handleSendFiveMinuteReminder(job: Job<{ sessionId: string }>) {
    const { sessionId } = job.data;
    this.logger.log(`Processing 5-minute reminder for session ${sessionId}`);

    try {
      const session = await this.sessionRepository.findOne({
        where: { id: sessionId },
      });

      if (!session) {
        this.logger.warn(`Session ${sessionId} not found for reminder job`);
        return;
      }

      if (session.status !== SessionStatus.SCHEDULED) {
        this.logger.log(
          `Skipping reminder for session ${sessionId}; status is ${session.status}`,
        );
        return;
      }

      if (!session.scheduledAt) {
        this.logger.warn(`Skipping reminder for session ${sessionId}; scheduledAt missing`);
        return;
      }

      if (new Date(session.scheduledAt).getTime() <= Date.now()) {
        this.logger.log(`Skipping reminder for session ${sessionId}; scheduled time already passed`);
        return;
      }

      await this.notificationService.sendLiveSessionReminderNotification(session.id);
      this.logger.log(`5-minute reminder sent for session ${sessionId}`);
    } catch (error: any) {
      this.logger.error(
        `Failed processing 5-minute reminder for session ${sessionId}: ${error?.message || 'Unknown error'}`,
        error?.stack,
      );
      throw error;
    }
  }
}
