import { Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Announcement } from '../entities/announcement.entity';
import { NotificationService } from '../notification/notification.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Processor('announcements')
@Injectable()
export class AnnouncementProcessor {
  private readonly logger = new Logger(AnnouncementProcessor.name);

  constructor(
    @InjectRepository(Announcement)
    private announcementRepository: Repository<Announcement>,
    private notificationService: NotificationService,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  @Process('publish-scheduled')
  async handleScheduledPublish(job: Job) {
    const { announcementId } = job.data;
    this.logger.log(`Processing scheduled announcement: ${announcementId}`);

    try {
      const announcement = await this.announcementRepository.findOne({
        where: { id: announcementId },
        relations: ['room', 'room.admin', 'author'],
      });

      if (!announcement) {
        this.logger.error(`Announcement ${announcementId} not found`);
        return;
      }

      if (announcement.isPublished) {
        this.logger.warn(`Announcement ${announcementId} already published`);
        return;
      }

      // Update announcement to published
      announcement.isPublished = true;
      await this.announcementRepository.save(announcement);
      // Create notifications and send FCM
      await this.notificationService.createAnnouncementNotifications(announcement);
      this.logger.log(`Successfully published announcement: ${announcementId}`);
    } catch (error) {
      this.logger.error(`Error processing scheduled announcement: ${error.message}`, error.stack);
      throw error;
    }
  }
}
