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

      // Notify WebSocket server to broadcast
      const wsServerUrl = this.configService.get('COMMUNICATIONS_SERVER_URL');
      if (wsServerUrl) {
        try {
          await firstValueFrom(
            this.httpService.post(`${wsServerUrl}/internal/announcement-published`, {
              id: announcement.id,
              title: announcement.title,
              content: announcement.content,
              isPublished: true,
              isEdited: announcement.isEdited,
              scheduledAt: announcement.scheduledAt,
              createdAt: announcement.createdAt,
              editedAt: announcement.editedAt,
              roomId: announcement.room.id,
              authorId: announcement.author.id,
              room: {
                id: announcement.room.id,
                title: announcement.room.title,
              },
              author: {
                id: announcement.author.id,
                firstName: announcement.author.firstName,
                lastName: announcement.author.lastName,
                email: announcement.author.email,
                image: announcement.author.image,
              },
            }),
          );
          this.logger.log(`WebSocket server notified for scheduled announcement ${announcementId}`);
        } catch (error) {
          this.logger.error(`Failed to notify WebSocket server: ${error.message}`);
        }
      }

      this.logger.log(`Successfully published announcement: ${announcementId}`);
    } catch (error) {
      this.logger.error(`Error processing scheduled announcement: ${error.message}`, error.stack);
      throw error;
    }
  }
}
