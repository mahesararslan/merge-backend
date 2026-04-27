import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { Notification } from '../entities/notification.entity';
import { FcmToken } from '../entities/fcm-token.entity';
import { Announcement } from '../entities/announcement.entity';
import { Assignment } from '../entities/assignment.entity';
import { AssignmentAttempt } from '../entities/assignment-attempt.entity';
import { Quiz } from '../entities/quiz.entity';
import { QuizAttempt } from '../entities/quiz-attempt.entity';
import { LiveSession, SessionStatus } from '../entities/live-video-session.entity';
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
      // Idempotency check: skip if notifications already exist for this announcement
      const existingCount = await this.notificationRepository
        .createQueryBuilder('n')
        .where("n.metadata LIKE :pattern", { pattern: `%"announcementId":"${announcement.id}"%` })
        .getCount();
      if (existingCount > 0) {
        this.logger.log(`Notifications already exist for announcement ${announcement.id}, skipping`);
        return;
      }

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
      const savedNotifications = await this.notificationRepository.save(notifications);
      const savedIds = savedNotifications.map((n) => n.id);
      this.logger.log(`Created ${savedNotifications.length} notifications for announcement ${announcement.id}`);

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
        savedIds,
      ).catch((error: any) => {
        this.logger.error(`Failed to send FCM notifications: ${error.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Error creating announcement notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createAssignmentNotifications(assignment: Assignment): Promise<void> {
    try {
      // Idempotency check: skip if notifications already exist for this assignment
      const existingCount = await this.notificationRepository
        .createQueryBuilder('n')
        .where("n.metadata LIKE :pattern", { pattern: `%"assignmentId":"${assignment.id}"%` })
        .getCount();
      if (existingCount > 0) {
        this.logger.log(`Notifications already exist for assignment ${assignment.id}, skipping`);
        return;
      }

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
          content: assignment.title,
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
      const savedNotifications = await this.notificationRepository.save(notifications);
      const savedIds = savedNotifications.map((n) => n.id);
      this.logger.log(`Created ${savedNotifications.length} notifications for assignment ${assignment.id}`);

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
        savedIds,
      ).catch((error: any) => {
        this.logger.error(`Failed to send FCM notifications: ${error.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Error creating assignment notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  async createQuizNotifications(quiz: Quiz): Promise<void> {
    try {
      // Idempotency check: skip if notifications already exist for this quiz
      const existingCount = await this.notificationRepository
        .createQueryBuilder('n')
        .where("n.metadata LIKE :pattern", { pattern: `%"quizId":"${quiz.id}"%` })
        .getCount();
      if (existingCount > 0) {
        this.logger.log(`Notifications already exist for quiz ${quiz.id}, skipping`);
        return;
      }

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
          content: quiz.title,
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
      const savedNotifications = await this.notificationRepository.save(notifications);
      const savedIds = savedNotifications.map((n) => n.id);
      this.logger.log(`Created ${savedNotifications.length} notifications for quiz ${quiz.id}`);

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
        savedIds,
      ).catch((error: any) => {
        this.logger.error(`Failed to send FCM notifications: ${error.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Error creating quiz notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Notify the assignment author (instructor) that a student submitted.
   * Caller must pass `attempt` with `user`, `assignment`, `assignment.room`,
   * and `assignment.author` relations loaded.
   */
  async createAssignmentSubmittedNotification(attempt: AssignmentAttempt): Promise<void> {
    try {
      const assignment = attempt.assignment;
      const submitter = attempt.user;
      const recipientId = assignment.author?.id;

      if (!recipientId || recipientId === submitter.id) {
        return;
      }

      const submitterName =
        [submitter.firstName, submitter.lastName].filter(Boolean).join(' ').trim() ||
        submitter.email ||
        'A student';

      const content = `${submitterName} submitted "${assignment.title}" in ${assignment.room.title}`;
      const actionUrl = `/rooms/${assignment.room.id}/assignments/${assignment.id}`;

      const notification = this.notificationRepository.create({
        user: { id: recipientId },
        content,
        metadata: {
          roomId: assignment.room.id,
          roomTitle: assignment.room.title,
          assignmentId: assignment.id,
          assignmentTitle: assignment.title,
          attemptId: attempt.id,
          submitterId: submitter.id,
          submitterName,
          kind: 'assignment-submitted',
          actionUrl,
        },
        isRead: false,
        pushSent: false,
      });

      const saved = await this.notificationRepository.save(notification);

      this.sendFcmNotifications(
        [recipientId],
        assignment.room.title,
        content,
        {
          type: 'assignment-submitted',
          roomId: assignment.room.id,
          roomTitle: assignment.room.title,
          assignmentId: assignment.id,
          assignmentTitle: assignment.title,
          attemptId: attempt.id,
          submitterId: submitter.id,
          submitterName,
          actionUrl,
        },
        [saved.id],
      ).catch((error: any) => {
        this.logger.error(`Failed to send FCM submission notification: ${error.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Error creating assignment-submitted notification: ${error.message}`, error.stack);
    }
  }

  /**
   * Notify a student that their assignment attempt was graded by the instructor.
   * Caller must pass `attempt` with `user`, `assignment`, and `assignment.room`
   * relations loaded.
   */
  async createAssignmentGradedNotification(attempt: AssignmentAttempt): Promise<void> {
    try {
      const assignment = attempt.assignment;
      const recipientId = attempt.user?.id;
      if (!recipientId) {
        return;
      }

      const content = `Your submission for "${assignment.title}" in ${assignment.room.title} has been graded`;
      const actionUrl = `/rooms/${assignment.room.id}/assignments/${assignment.id}`;

      const notification = this.notificationRepository.create({
        user: { id: recipientId },
        content,
        metadata: {
          roomId: assignment.room.id,
          roomTitle: assignment.room.title,
          assignmentId: assignment.id,
          assignmentTitle: assignment.title,
          attemptId: attempt.id,
          score: attempt.score,
          kind: 'assignment-graded',
          actionUrl,
        },
        isRead: false,
        pushSent: false,
      });

      const saved = await this.notificationRepository.save(notification);

      this.sendFcmNotifications(
        [recipientId],
        assignment.room.title,
        content,
        {
          type: 'assignment-graded',
          roomId: assignment.room.id,
          roomTitle: assignment.room.title,
          assignmentId: assignment.id,
          assignmentTitle: assignment.title,
          attemptId: attempt.id,
          score: String(attempt.score ?? ''),
          actionUrl,
        },
        [saved.id],
      ).catch((error: any) => {
        this.logger.error(`Failed to send FCM grading notification: ${error.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Error creating assignment-graded notification: ${error.message}`, error.stack);
    }
  }

  /**
   * Notify the quiz author (instructor) that a student submitted a quiz attempt.
   * Caller must pass `attempt` with `user`, `quiz`, `quiz.room`, and `quiz.author`
   * relations loaded.
   */
  async createQuizSubmittedNotification(attempt: QuizAttempt): Promise<void> {
    try {
      const quiz = attempt.quiz;
      const submitter = attempt.user;
      const recipientId = quiz.author?.id;

      if (!recipientId || recipientId === submitter.id) {
        return;
      }

      const submitterName =
        [submitter.firstName, submitter.lastName].filter(Boolean).join(' ').trim() ||
        submitter.email ||
        'A student';

      const content = `${submitterName} submitted "${quiz.title}" in ${quiz.room.title}`;
      const actionUrl = `/rooms/${quiz.room.id}/quizzes/${quiz.id}`;

      const notification = this.notificationRepository.create({
        user: { id: recipientId },
        content,
        metadata: {
          roomId: quiz.room.id,
          roomTitle: quiz.room.title,
          quizId: quiz.id,
          quizTitle: quiz.title,
          attemptId: attempt.id,
          submitterId: submitter.id,
          submitterName,
          score: attempt.score,
          kind: 'quiz-submitted',
          actionUrl,
        },
        isRead: false,
        pushSent: false,
      });

      const saved = await this.notificationRepository.save(notification);

      this.sendFcmNotifications(
        [recipientId],
        quiz.room.title,
        content,
        {
          type: 'quiz-submitted',
          roomId: quiz.room.id,
          roomTitle: quiz.room.title,
          quizId: quiz.id,
          quizTitle: quiz.title,
          attemptId: attempt.id,
          submitterId: submitter.id,
          submitterName,
          score: String(attempt.score ?? ''),
          actionUrl,
        },
        [saved.id],
      ).catch((error: any) => {
        this.logger.error(`Failed to send FCM quiz-submission notification: ${error.message}`);
      });
    } catch (error: any) {
      this.logger.error(`Error creating quiz-submitted notification: ${error.message}`, error.stack);
    }
  }

  private async sendFcmNotifications(
    userIds: string[],
    roomTitle: string,
    contentTitle: string,
    data: Record<string, string>,
    notificationIds: string[] = [],
  ): Promise<void> {
    try {
      // Skip if no recipients (empty where[] in TypeORM returns ALL rows)
      if (userIds.length === 0) {
        this.logger.log('No recipients for FCM notification, skipping');
        return;
      }

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
        data.type === 'live-session-created' ? 'Session Created' :
        data.type === 'live-session-started' ? 'Session Started' :
        data.type === 'live-session-reminder' ? 'Session Reminder' :
        data.type === 'assignment-due-soon' ? 'Assignment Due Soon' :
        data.type === 'quiz-due-soon' ? 'Quiz Due Soon' :
        data.type === 'calendar-reminder' ? 'Calendar Reminder' :
        data.type === 'assignment-submitted' ? 'Assignment Submitted' :
        data.type === 'assignment-graded' ? 'Assignment Graded' :
        data.type === 'quiz-submitted' ? 'Quiz Submitted' :
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

      // Clean up invalid tokens that FCM rejected
      if (result.invalidTokens && result.invalidTokens.length > 0) {
        await this.fcmTokenRepository
          .createQueryBuilder()
          .delete()
          .where('token IN (:...tokens)', { tokens: result.invalidTokens })
          .execute();
        this.logger.log(`Deleted ${result.invalidTokens.length} invalid FCM tokens`);
      }

      // Mark notifications as push sent using reliable ID-based query
      if (notificationIds.length > 0) {
        await this.notificationRepository.update(
          { id: In(notificationIds) },
          { pushSent: true },
        );
      }
    } catch (error: any) {
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

  private async resolveLiveSession(sessionId: string): Promise<LiveSession | null> {
    return this.notificationRepository.manager.getRepository(LiveSession).findOne({
      where: { id: sessionId },
      relations: ['room', 'room.admin', 'host'],
    });
  }

  private async getLiveSessionRecipients(
    session: LiveSession,
    actorId?: string,
  ): Promise<string[]> {
    const roomMembers = await this.roomMemberRepository.find({
      where: { room: { id: session.room.id } },
      relations: ['user'],
    });

    const allUserIds = new Set<string>([
      session.room.admin.id,
      ...roomMembers.map((member) => member.user.id),
    ]);

    if (actorId) {
      allUserIds.delete(actorId);
    }

    return Array.from(allUserIds);
  }

  async createLiveSessionCreatedNotifications(session: LiveSession, actorId?: string): Promise<void> {
    const loadedSession = await this.resolveLiveSession(session.id);
    if (!loadedSession) {
      this.logger.warn(`Session ${session.id} not found for created notifications`);
      return;
    }

    const recipientIds = await this.getLiveSessionRecipients(loadedSession, actorId);
    if (recipientIds.length === 0) {
      return;
    }

    const isScheduled = loadedSession.status === SessionStatus.SCHEDULED;
    const title = loadedSession.title;
    const body = isScheduled
      ? `Session scheduled: ${title}`
      : `Session is live: ${title}`;
    const actionUrl = isScheduled
      ? `/rooms/${loadedSession.room.id}/sessions`
      : `/rooms/${loadedSession.room.id}/live?sessionId=${loadedSession.id}`;

    const notifications: Notification[] = recipientIds.map((userId) =>
      this.notificationRepository.create({
        user: { id: userId },
        content: body,
        metadata: {
          roomId: loadedSession.room.id,
          roomTitle: loadedSession.room.title,
          sessionId: loadedSession.id,
          sessionTitle: loadedSession.title,
          actionUrl,
        },
        isRead: false,
        pushSent: false,
      }),
    );

    const savedNotifications = await this.notificationRepository.save(notifications);
    const savedIds = savedNotifications.map((notification) => notification.id);

    await this.sendFcmNotifications(
      recipientIds,
      loadedSession.room.title,
      body,
      {
        type: 'live-session-created',
        roomId: loadedSession.room.id,
        roomTitle: loadedSession.room.title,
        sessionId: loadedSession.id,
        sessionTitle: loadedSession.title,
        actionUrl,
      },
      savedIds,
    );
  }

  async createLiveSessionStartedNotifications(session: LiveSession, actorId?: string): Promise<void> {
    const loadedSession = await this.resolveLiveSession(session.id);
    if (!loadedSession) {
      this.logger.warn(`Session ${session.id} not found for started notifications`);
      return;
    }

    const recipientIds = await this.getLiveSessionRecipients(loadedSession, actorId);
    if (recipientIds.length === 0) {
      return;
    }

    const body = `Session started: ${loadedSession.title}`;
    const actionUrl = `/rooms/${loadedSession.room.id}/live?sessionId=${loadedSession.id}`;

    const notifications: Notification[] = recipientIds.map((userId) =>
      this.notificationRepository.create({
        user: { id: userId },
        content: body,
        metadata: {
          roomId: loadedSession.room.id,
          roomTitle: loadedSession.room.title,
          sessionId: loadedSession.id,
          sessionTitle: loadedSession.title,
          actionUrl,
        },
        isRead: false,
        pushSent: false,
      }),
    );

    const savedNotifications = await this.notificationRepository.save(notifications);
    const savedIds = savedNotifications.map((notification) => notification.id);

    await this.sendFcmNotifications(
      recipientIds,
      loadedSession.room.title,
      body,
      {
        type: 'live-session-started',
        roomId: loadedSession.room.id,
        roomTitle: loadedSession.room.title,
        sessionId: loadedSession.id,
        sessionTitle: loadedSession.title,
        actionUrl,
      },
      savedIds,
    );
  }

  async sendLiveSessionReminderNotification(sessionId: string): Promise<void> {
    const session = await this.resolveLiveSession(sessionId);
    if (!session) {
      this.logger.warn(`Session ${sessionId} not found for reminder notification`);
      return;
    }

    if (session.status !== SessionStatus.SCHEDULED) {
      this.logger.log(
        `Skipping reminder notification for session ${sessionId}; status is ${session.status}`,
      );
      return;
    }

    const recipientIds = await this.getLiveSessionRecipients(session, session.host?.id);
    if (recipientIds.length === 0) {
      return;
    }

    const body = `Reminder: Session starts in 5 minutes - ${session.title}`;

    await this.sendFcmNotifications(
      recipientIds,
      session.room.title,
      body,
      {
        type: 'live-session-reminder',
        roomId: session.room.id,
        roomTitle: session.room.title,
        sessionId: session.id,
        sessionTitle: session.title,
        actionUrl: `/rooms/${session.room.id}/sessions`,
      },
    );
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

  async sendNotificationToUser(
    userId: string,
    content: string,
    metadata: Record<string, any> = {},
  ): Promise<void> {
    try {
      const notification = this.notificationRepository.create({
        user: { id: userId } as any,
        content,
        metadata,
        isRead: false,
      });
      const saved = await this.notificationRepository.save(notification);
      await this.sendFcmNotifications(
        [userId],
        'Merge',
        content,
        { type: 'general', notificationId: saved.id, ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)])) },
        [saved.id],
      );
    } catch (error: any) {
      this.logger.error(`Failed to send notification to user ${userId}: ${error.message}`);
    }
  }
}
