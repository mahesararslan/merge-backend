import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Notification } from '../entities/notification.entity';
import { FcmToken } from '../entities/fcm-token.entity';
import { Announcement } from '../entities/announcement.entity';
import { Assignment } from '../entities/assignment.entity';
import { Quiz } from '../entities/quiz.entity';
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
          roomTitle: announcement.room.title,
          announcementId: announcement.id,
          announcementTitle: announcement.title,
          authorId: announcement.author.id,
          actionUrl: `/rooms/${announcement.room.id}/announcements/${announcement.id}`,
        },
      ).catch((error) => {
        this.logger.error(`Failed to send FCM notifications: ${error.message}`);
      });
    } catch (error) {
      this.logger.error(`Error creating announcement notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createAssignmentNotifications(assignment: Assignment): Promise<void> {
    try {
      // Get all members of the room
      const roomMembers = await this.roomMemberRepository.find({
        where: { room: { id: assignment.room.id } },
        relations: ['user'],
      });

      // Also include room admin
      const allUserIds = new Set([
        assignment.room.admin.id,
        ...roomMembers.map((member) => member.user.id),
      ]);

      // Remove author from notification recipients
      allUserIds.delete(assignment.author.id);

      const notifications: Notification[] = [];

      for (const userId of allUserIds) {
        const notification = this.notificationRepository.create({
          user: { id: userId },
          content: `New assignment in ${assignment.room.title}: ${assignment.title}`,
          metadata: {
            roomId: assignment.room.id,
            roomTitle: assignment.room.title,
            assignmentId: assignment.id,
            assignmentTitle: assignment.title,
            authorId: assignment.author.id,
            actionUrl: `/rooms/${assignment.room.id}/assignments/${assignment.id}`,
          },
          isRead: false,
          pushSent: false,
        });
        notifications.push(notification);
      }

      // Save all notifications
      await this.notificationRepository.save(notifications);
      this.logger.log(`Created ${notifications.length} notifications for assignment ${assignment.id}`);

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
        assignment.room.title,
        assignment.title,
        {
          type: 'assignment',
          roomId: assignment.room.id,
          roomTitle: assignment.room.title,
          assignmentId: assignment.id,
          assignmentTitle: assignment.title,
          authorId: assignment.author.id,
          actionUrl: `/rooms/${assignment.room.id}/assignments/${assignment.id}`,
        },
      ).catch((error) => {
        this.logger.error(`Failed to send FCM notifications: ${error.message}`);
      });
    } catch (error) {
      this.logger.error(`Error creating assignment notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createQuizNotifications(quiz: Quiz): Promise<void> {
    try {
      // Get all members of the room
      const roomMembers = await this.roomMemberRepository.find({
        where: { room: { id: quiz.room.id } },
        relations: ['user'],
      });

      // Also include room admin
      const allUserIds = new Set([
        quiz.room.admin.id,
        ...roomMembers.map((member) => member.user.id),
      ]);

      // Remove author from notification recipients
      allUserIds.delete(quiz.author.id);

      const notifications: Notification[] = [];

      for (const userId of allUserIds) {
        const notification = this.notificationRepository.create({
          user: { id: userId },
          content: `New quiz in ${quiz.room.title}: ${quiz.title}`,
          metadata: {
            roomId: quiz.room.id,
            roomTitle: quiz.room.title,
            quizId: quiz.id,
            quizTitle: quiz.title,
            authorId: quiz.author.id,
            actionUrl: `/rooms/${quiz.room.id}/quizzes/${quiz.id}`,
          },
          isRead: false,
          pushSent: false,
        });
        notifications.push(notification);
      }

      // Save all notifications
      await this.notificationRepository.save(notifications);
      this.logger.log(`Created ${notifications.length} notifications for quiz ${quiz.id}`);

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
        quiz.room.title,
        quiz.title,
        {
          type: 'quiz',
          roomId: quiz.room.id,
          roomTitle: quiz.room.title,
          quizId: quiz.id,
          quizTitle: quiz.title,
          authorId: quiz.author.id,
          actionUrl: `/rooms/${quiz.room.id}/quizzes/${quiz.id}`,
        },
      ).catch((error) => {
        this.logger.error(`Failed to send FCM notifications: ${error.message}`);
      });
    } catch (error) {
      this.logger.error(`Error creating quiz notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  private async sendFcmNotifications(
    userIds: string[],
    roomTitle: string,
    contentTitle: string,
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

      // Determine title prefix based on notification type
      const titlePrefix = 
        data.type === 'assignment' ? 'New Assignment' : 
        data.type === 'quiz' ? 'New Quiz' : 
        'New Announcement';

      // Send multicast notification
      const result = await this.firebaseService.sendMulticast(tokens, {
        title: `${titlePrefix} - ${roomTitle}`,
        body: contentTitle,
        data,
      });

      this.logger.log(
        `FCM sent: ${result.successCount} success, ${result.failureCount} failures`,
      );

      // Mark notifications as push sent
      const metadataKey = 
        data.type === 'assignment' ? 'assignmentId' : 
        data.type === 'quiz' ? 'quizId' : 
        'announcementId';
      await this.notificationRepository.update(
        {
          metadata: { [metadataKey]: data[metadataKey] } as any,
        },
        { pushSent: true },
      );
    } catch (error) {
      this.logger.error(`Error sending FCM notifications: ${error.message}`, error.stack);
    }
  }

  async getUserNotifications(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{
    notifications: Notification[];
    total: number;
    unreadCount: number;
    totalPages: number;
    currentPage: number;
  }> {
    const skip = (page - 1) * limit;

    const [notifications, total] = await this.notificationRepository.findAndCount({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    const unreadCount = await this.notificationRepository.count({
      where: { user: { id: userId }, isRead: false },
    });

    return {
      notifications,
      total,
      unreadCount,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  async markAsRead(notificationId: string, userId: string): Promise<Notification> {
    const notification = await this.notificationRepository.findOne({
      where: { id: notificationId, user: { id: userId } },
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    notification.isRead = true;
    return this.notificationRepository.save(notification);
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.notificationRepository.update(
      { user: { id: userId }, isRead: false },
      { isRead: true },
    );
  }

  async deleteNotification(notificationId: string, userId: string): Promise<void> {
    const result = await this.notificationRepository.delete({
      id: notificationId,
      user: { id: userId },
    });

    if (result.affected === 0) {
      throw new Error('Notification not found');
    }
  }

  async sendAssignmentDueSoonNotification(assignmentId: string): Promise<void> {
    // Find assignment with room, admin, author
    const assignment = await this.notificationRepository.manager.getRepository(Assignment).findOne({
      where: { id: assignmentId },
      relations: ['room', 'room.admin', 'author'],
    });
    if (!assignment) {
      this.logger.error(`Assignment ${assignmentId} not found for due soon notification`);
      return;
    }
    // Get all members of the room
    const roomMembers = await this.roomMemberRepository.find({
      where: { room: { id: assignment.room.id } },
      relations: ['user'],
    });
    const allUserIds = new Set([
      assignment.room.admin.id,
      ...roomMembers.map((member) => member.user.id),
    ]);
    allUserIds.delete(assignment.author.id);
    // Send FCM notification
    await this.sendFcmNotifications(
      Array.from(allUserIds),
      assignment.room.title,
      `Assignment due in 24 hours: ${assignment.title}`,
      {
        type: 'assignment-due-soon',
        roomId: assignment.room.id,
        roomTitle: assignment.room.title,
        assignmentId: assignment.id,
        assignmentTitle: assignment.title,
        authorId: assignment.author.id,
        actionUrl: `/rooms/${assignment.room.id}/assignments/${assignment.id}`,
      },
    );
    this.logger.log(`Sent 24hr-before-due push notification for assignment ${assignment.id}`);
  }

  async sendQuizDueSoonNotification(quizId: string): Promise<void> {
    // Find quiz with room, admin, author
    const quiz = await this.notificationRepository.manager.getRepository(Quiz).findOne({
      where: { id: quizId },
      relations: ['room', 'room.admin', 'author'],
    });
    if (!quiz) {
      this.logger.error(`Quiz ${quizId} not found for due soon notification`);
      return;
    }
    // Get all members of the room
    const roomMembers = await this.roomMemberRepository.find({
      where: { room: { id: quiz.room.id } },
      relations: ['user'],
    });
    const allUserIds = new Set([
      quiz.room.admin.id,
      ...roomMembers.map((member) => member.user.id),
    ]);
    allUserIds.delete(quiz.author.id);
    // Send FCM notification
    await this.sendFcmNotifications(
      Array.from(allUserIds),
      quiz.room.title,
      `Quiz due in 24 hours: ${quiz.title}`,
      {
        type: 'quiz-due-soon',
        roomId: quiz.room.id,
        roomTitle: quiz.room.title,
        quizId: quiz.id,
        quizTitle: quiz.title,
        authorId: quiz.author.id,
        actionUrl: `/rooms/${quiz.room.id}/quizzes/${quiz.id}`,
      },
    );
    this.logger.log(`Sent 24hr-before-due push notification for quiz ${quiz.id}`);
  }

  async sendCalendarEventReminder(eventId: string, type: '24hr' | '5min'): Promise<void> {
    // Find event with owner
    const event = await this.notificationRepository.manager.getRepository(require('../entities/calendar-event.entity').CalendarEvent).findOne({
      where: { id: eventId },
      relations: ['owner'],
    });
    if (!event) {
      this.logger.error(`Calendar event ${eventId} not found for reminder`);
      return;
    }
    // Only notify the owner
    const userId = event.owner.id;
    let message = '';
    if (type === '24hr') {
      message = `Reminder: Your calendar task "${event.title}" is due in 24 hours.`;
    } else {
      message = `Reminder: Your calendar task "${event.title}" is due in 5 minutes!`;
    }
    await this.sendFcmNotifications(
      [userId],
      'Calendar',
      message,
      {
        type: 'calendar-reminder',
        eventId: event.id,
        eventTitle: event.title,
        deadline: event.deadline.toISOString(),
        reminderType: type,
        actionUrl: `/calendar/${event.id}`,
      },
    );
    this.logger.log(`Sent ${type} reminder push notification for calendar event ${event.id}`);
  }
}
