import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Notification } from '../entities/notification.entity';
import { FcmToken } from '../entities/fcm-token.entity';
import { Announcement } from '../entities/announcement.entity';
import { RoomMember } from '../entities/room-member.entity';
import { FirebaseService } from '../firebase/firebase.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectRepository(Notification)
    private notificationRepository: Repository<Notification>,
    @InjectRepository(FcmToken)
    private fcmTokenRepository: Repository<FcmToken>,
    @InjectRepository(RoomMember)
    private roomMemberRepository: Repository<RoomMember>,
    private firebaseService: FirebaseService,
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  async createAnnouncementNotifications(announcement: Announcement): Promise<void> {
    try {
      // Get all members of the room
      const roomMembers = await this.roomMemberRepository.find({
        where: { room: { id: announcement.room.id } },
        relations: ['user'],
      });

      // Also include room admin
      const allUserIds = new Set([
        announcement.room.admin.id,
        ...roomMembers.map((member) => member.user.id),
      ]);

      // Remove author from notification recipients
      allUserIds.delete(announcement.author.id);

      const notifications: Notification[] = [];

      for (const userId of allUserIds) {
        const notification = this.notificationRepository.create({
          user: { id: userId },
          content: `New announcement in ${announcement.room.title}: ${announcement.title}`,
          metadata: {
            roomId: announcement.room.id,
            roomTitle: announcement.room.title,
            announcementId: announcement.id,
            announcementTitle: announcement.title,
            authorId: announcement.author.id,
            actionUrl: `/rooms/${announcement.room.id}/announcements/${announcement.id}`,
          },
          isRead: false,
          pushSent: false,
        });
        notifications.push(notification);
      }

      // Save all notifications
      await this.notificationRepository.save(notifications);
      this.logger.log(`Created ${notifications.length} notifications for announcement ${announcement.id}`);

      // Send live notifications to WebSocket server for online users
      const wsServerUrl = this.configService.get('COMMUNICATIONS_SERVER_URL');
      if (wsServerUrl) {
        for (const notification of notifications) {
          try {
            await firstValueFrom(
              this.httpService.post(`${wsServerUrl}/internal/notification`, {
                userId: notification.user.id,
                notification: {
                  id: notification.id,
                  content: notification.content,
                  isRead: notification.isRead,
                  metadata: notification.metadata,
                  expiresAt: notification.expiresAt,
                  createdAt: notification.createdAt,
                },
              }),
            );
          } catch (error) {
            // Log but don't throw - WebSocket notification is not critical
            this.logger.error(`Failed to send WebSocket notification to user ${notification.user.id}: ${error.message}`);
          }
        }
        this.logger.log(`Sent WebSocket notifications to ${notifications.length} users`);
      }

      // Send FCM notifications asynchronously
      this.sendFcmNotifications(
        Array.from(allUserIds),
        announcement.room.title,
        announcement.title,
        {
          type: 'announcement',
          roomId: announcement.room.id,
          announcementId: announcement.id,
        },
      ).catch((error) => {
        this.logger.error(`Failed to send FCM notifications: ${error.message}`);
      });
    } catch (error) {
      this.logger.error(`Error creating announcement notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async sendFcmNotifications(
    userIds: string[],
    roomTitle: string,
    announcementTitle: string,
    data: Record<string, string>,
  ): Promise<void> {
    try {
      // Get all FCM tokens for these users
      const fcmTokens = await this.fcmTokenRepository.find({
        where: userIds.map((userId) => ({ user: { id: userId } })),
        relations: ['user'],
      });

      if (fcmTokens.length === 0) {
        this.logger.log('No FCM tokens found for notification recipients');
        return;
      }

      const tokens = fcmTokens.map((ft) => ft.token);

      // Send multicast notification
      const result = await this.firebaseService.sendMulticast(tokens, {
        title: `New Announcement - ${roomTitle}`,
        body: announcementTitle,
        data,
      });

      this.logger.log(
        `FCM sent: ${result.successCount} success, ${result.failureCount} failures`,
      );

      // Mark notifications as push sent
      await this.notificationRepository.update(
        {
          metadata: { announcementId: data.announcementId } as any,
        },
        { pushSent: true },
      );
    } catch (error) {
      this.logger.error(`Error sending FCM notifications: ${error.message}`, error.stack);
    }
  }
}
