import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bull';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Queue } from 'bull';
import { firstValueFrom } from 'rxjs';
import { LiveSession, SessionStatus } from '../entities/live-video-session.entity';
import { SessionAttendee } from '../entities/live-video-sesssion-attendee.entity';
import { FocusReport } from '../entities/focus-report.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { QuerySessionDto } from './dto/query-session.dto';
import { CalendarService } from '../calendar/calendar.service';
import { TaskCategory } from '../entities/calendar-event.entity';
import { LeaveSessionDto } from './dto/leave-session.dto';
import { SaveFocusReportDto } from './dto/focus-report.dto';
import { TranscriptionService } from '../transcription/transcription.service';
import { CanvasPermissionService } from '../canvas/canvas-permission.service';
import { cleanupYjsRoom } from '../canvas/yjs-ws-server';
import { NotificationService } from '../notification/notification.service';
import { LiveKitService } from '../livekit/livekit.service';
import { RewardsService } from '../rewards/rewards.service';
import { ChallengeAction } from '../entities/challenge-definition.entity';

@Injectable()
export class LiveSessionService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveSessionService.name);
  private readonly communicationServiceUrl: string;
  private readonly autoEndGraceMs: number;
  private readonly autoEndTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    @InjectRepository(LiveSession)
    private sessionRepository: Repository<LiveSession>,
    @InjectRepository(SessionAttendee)
    private attendeeRepository: Repository<SessionAttendee>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(RoomMember)
    private roomMemberRepository: Repository<RoomMember>,
    @InjectRepository(FocusReport)
    private focusReportRepository: Repository<FocusReport>,
    @InjectQueue('live-sessions')
    private readonly sessionQueue: Queue,
    private calendarService: CalendarService,
    private readonly notificationService: NotificationService,
    private readonly livekitService: LiveKitService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly transcriptionService: TranscriptionService,
    private readonly canvasPermissionService: CanvasPermissionService,
    private readonly rewardsService: RewardsService,
  ) {
    this.communicationServiceUrl =
      this.configService.get<string>('COMMUNICATIONS_SERVER_URL') ||
      this.configService.get<string>('COMMUNICATION_SERVICE_URL') ||
      this.configService.get<string>('COMMUNICATION_URL') ||
      'http://localhost:3002';

    const graceMsRaw = this.configService.get<string>('LIVE_SESSION_AUTO_END_GRACE_MS');
    const parsedGrace = graceMsRaw ? parseInt(graceMsRaw, 10) : NaN;
    this.autoEndGraceMs = Number.isFinite(parsedGrace) && parsedGrace > 0 ? parsedGrace : 60_000;
  }

  onModuleDestroy() {
    this.autoEndTimers.forEach((timer) => clearTimeout(timer));
    this.autoEndTimers.clear();
  }

  private scheduleAutoEnd(sessionId: string) {
    if (this.autoEndTimers.has(sessionId)) {
      return;
    }

    const timer = setTimeout(async () => {
      this.autoEndTimers.delete(sessionId);
      try {
        const session = await this.sessionRepository.findOne({
          where: { id: sessionId },
          relations: ['room', 'attendees', 'attendees.user', 'host', 'actingHost'],
        });

        if (!session) {
          return;
        }

        if (session.status !== SessionStatus.LIVE) {
          return;
        }

        const activeAttendees = session.attendees?.filter((attendee) => !attendee.leftAt) ?? [];
        if (activeAttendees.length > 0) {
          return;
        }

        await this.finalizeSession(session, 'auto');
      } catch (error: any) {
        this.logger.error(`Auto-end timer failed for session ${sessionId}: ${error?.message || 'Unknown error'}`);
      }
    }, this.autoEndGraceMs);

    this.autoEndTimers.set(sessionId, timer);
    this.logger.log(`Scheduled auto end for session ${sessionId} in ${this.autoEndGraceMs}ms`);
  }

  private cancelAutoEnd(sessionId: string) {
    const timer = this.autoEndTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.autoEndTimers.delete(sessionId);
      this.logger.log(`Cancelled auto end for session ${sessionId}`);
    }
  }

  private async finalizeSession(
    session: LiveSession,
    reason: 'manual' | 'auto',
    endedBy?: string,
  ) {
    this.cancelAutoEnd(session.id);

    if (session.status === SessionStatus.ENDED) {
      return this.formatSessionResponse(session);
    }

    session.status = SessionStatus.ENDED;
    session.endedAt = new Date();
    session.actingHost = null;

    if (session.startedAt) {
      const durationMs = session.endedAt.getTime() - session.startedAt.getTime();
      session.durationMinutes = Math.max(0, Math.round(durationMs / (1000 * 60)));
    }

    const updated = await this.sessionRepository.save(session);
    this.logger.log(`Session ${updated.id} ended (${reason})`);

    await this.notifySessionEnded(updated, reason, endedBy);

    // Clean up canvas permissions and Yjs room
    this.canvasPermissionService.clearSession(updated.id).catch((err) => {
      this.logger.error(`Canvas permission cleanup failed for ${updated.id}: ${err?.message}`);
    });
    cleanupYjsRoom(updated.id);

    this.processTranscriptionAsync(updated).catch((err) => {
      this.logger.error(`Post-session transcription failed for ${updated.id}: ${err?.message}`);
    });

    return this.formatSessionResponse(updated);
  }

  private async processTranscriptionAsync(session: LiveSession): Promise<void> {
    // Lecture summary is a Pro/Max feature — check host's subscription tier
    const { PLAN_LIMITS } = await import('../subscription/plan-limits.const');
    const hostTier = session.host?.subscriptionTier;
    if (hostTier && !PLAN_LIMITS[hostTier].hasLectureSummary) {
      this.logger.log(`Skipping lecture summary for session ${session.id}: host on ${hostTier} plan`);
      return;
    }

    const { text: transcript, language } = await this.transcriptionService.finalizeTranscript(session.id);
    if (!transcript) {
      this.logger.log(`No transcript for session ${session.id}, skipping notes generation`);
      return;
    }

    const { summaryText, summaryPdfUrl } = await this.transcriptionService.generateNotesAndPdf(
      session.id,
      session.title,
      transcript,
      language,
    );

    await this.sessionRepository.update(session.id, { summaryText, summaryPdfUrl });
    this.logger.log(`Notes PDF saved for session ${session.id}: ${summaryPdfUrl}`);
  }

  private async notifyCommunications(
    eventType: 'session-created' | 'session-started' | 'session-cancelled' | 'session-ended',
    data: any,
  ) {
    const endpoint = eventType === 'session-ended' ? 'live-session-ended' : 'live-session-event';
    const payload = eventType === 'session-ended' ? data : { type: eventType, ...data };

    try {
      const headers: Record<string, string> = {};
      const internalSecret = this.configService.get<string>('INTERNAL_SERVICE_SECRET');
      if (internalSecret) {
        headers['x-internal-secret'] = internalSecret;
      }

      await firstValueFrom(
        this.httpService.post(
          `${this.communicationServiceUrl}/internal/${endpoint}`,
          payload,
          { headers },
        ),
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to notify communications about ${eventType}: ${error?.message || 'Unknown error'}`,
      );
    }
  }

  private async notifySessionEnded(
    session: LiveSession,
    reason: 'manual' | 'auto',
    endedBy?: string,
  ) {
    const sessionWithRoom = session.room
      ? session
      : await this.sessionRepository.findOne({
          where: { id: session.id },
          relations: ['room'],
        });

    if (!sessionWithRoom?.room) {
      this.logger.warn(`Unable to notify communications about session ${session.id}; room relation missing.`);
      return;
    }

    const data = {
      roomId: sessionWithRoom.room.id,
      sessionId: sessionWithRoom.id,
      reason,
      endedAt: sessionWithRoom.endedAt?.toISOString(),
      endedBy,
    };

    await this.notifyCommunications('session-ended', data);
  }

  /**
   * Create a session. If scheduledAt is provided, session is SCHEDULED (host starts manually later).
   * If scheduledAt is NOT provided, session starts immediately (status = LIVE).
   */
  async create(createSessionDto: CreateSessionDto, userId: string) {
    const room = await this.roomRepository.findOne({
      where: { id: createSessionDto.roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isScheduled = !!createSessionDto.scheduledAt;
    const now = new Date();

    if (isScheduled) {
      const scheduledDate = new Date(createSessionDto.scheduledAt!);
      if (scheduledDate <= now) {
        throw new BadRequestException('Scheduled time must be in the future');
      }
    }

    const session = this.sessionRepository.create({
      title: createSessionDto.title,
      description: createSessionDto.description || null,
      status: isScheduled ? SessionStatus.SCHEDULED : SessionStatus.LIVE,
      scheduledAt: isScheduled ? new Date(createSessionDto.scheduledAt!) : null,
      startedAt: isScheduled ? null : now,
    } as Partial<LiveSession>);
    session.room = room;
    session.host = user;

    const saved = await this.sessionRepository.save(session);
    this.logger.log(`Session created: ${saved.id} (${saved.status})`);

    // If instant live, ensure LiveKit room
    if (!isScheduled) {
      await this.livekitService.ensureSessionRoom(saved.id).catch((err) => {
        this.logger.error(`Failed to ensure LiveKit room for session ${saved.id}: ${err.message}`);
      });
    }

    // Create calendar event for all room members
    const calendarDeadline = isScheduled
      ? createSessionDto.scheduledAt!
      : now.toISOString();

    try {
      await this.calendarService.createForRoomMembers({
        title: `Live Session: ${saved.title}`,
        description: saved.description || '',
        deadline: calendarDeadline,
        taskCategory: TaskCategory.VIDEO_SESSION,
      }, room.id, { scheduleReminders: false }); // Disable default calendar reminders
    } catch (error: any) {
      this.logger.error(`Failed to create calendar events: ${error.message}`);
    }

    // Schedule 5-minute reminder if scheduled more than 5 minutes out
    if (isScheduled && saved.scheduledAt) {
      const delay = saved.scheduledAt.getTime() - Date.now() - 5 * 60 * 1000;
      if (delay > 0) {
        await this.sessionQueue.add(
          'send-5min-reminder',
          { sessionId: saved.id },
          { delay, jobId: `reminder-${saved.id}`, removeOnComplete: true },
        );
      }
    }

    // Send created notifications
    await this.notificationService.createLiveSessionCreatedNotifications(saved, userId).catch((err) => {
      this.logger.error(`Failed to send session-created notifications: ${err.message}`);
    });

    // Notify communications
    await this.notifyCommunications('session-created', {
      roomId: room.id,
      session: this.formatSessionResponse(saved),
    });

    return this.formatSessionResponse(saved);
  }

  /**
   * Fetch sessions for a room with optional status filter and pagination.
   */
  async findAll(queryDto: QuerySessionDto, userId: string) {
    const page = parseInt(queryDto.page || '1');
    const limit = parseInt(queryDto.limit || '20');
    const sortBy = queryDto.sortBy || 'createdAt';
    const sortOrder = queryDto.sortOrder || 'DESC';
    const skip = (page - 1) * limit;

    let queryBuilder = this.sessionRepository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.room', 'room')
      .leftJoinAndSelect('session.host', 'host')
      .leftJoin('session.attendees', 'attendee', 'attendee.leftAt IS NULL')
      .addSelect('COUNT(attendee.id)', 'attendee_count')
      .where('room.id = :roomId', { roomId: queryDto.roomId })
      .groupBy('session.id')
      .addGroupBy('room.id')
      .addGroupBy('host.id');

    // Status filter
    if (queryDto.status) {
      queryBuilder.andWhere('session.status = :status', { status: queryDto.status });
    }

    const rawResults = await queryBuilder
      .orderBy(`session.${sortBy}`, sortOrder)
      .offset(skip)
      .limit(limit)
      .getRawAndEntities();

    const total = await this.sessionRepository
      .createQueryBuilder('session')
      .leftJoin('session.room', 'room')
      .where('room.id = :roomId', { roomId: queryDto.roomId })
      .andWhere(queryDto.status ? 'session.status = :status' : '1=1', queryDto.status ? { status: queryDto.status } : {})
      .getCount();

    // Map attendee counts to sessions
    const sessions = rawResults.entities.map((session, idx) => {
      const raw = rawResults.raw[idx];
      const count = parseInt(raw?.attendee_count || '0');
      return this.formatSessionResponse(session, count);
    });

    return {
      sessions,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
    };
  }

  /**
   * Get a single session with attendee details.
   */
  async findOne(id: string, userId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['room', 'host', 'actingHost', 'attendees', 'attendees.user'],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // Filter out attendees who have left
    if (session.attendees) {
      session.attendees = session.attendees.filter(a => !a.leftAt);
    }

    return this.formatSessionResponse(session);
  }

  /**
   * Update session details (admin only).
   */
  async update(id: string, updateSessionDto: UpdateSessionDto, userId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'host'],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can update sessions');
    }

    if (updateSessionDto.title) session.title = updateSessionDto.title;
    if (updateSessionDto.description !== undefined) session.description = updateSessionDto.description;
    if (updateSessionDto.scheduledAt) {
      const scheduledDate = new Date(updateSessionDto.scheduledAt);
      if (scheduledDate <= new Date()) {
        throw new BadRequestException('Scheduled time must be in the future');
      }
      session.scheduledAt = scheduledDate;
    }

    const updated = await this.sessionRepository.save(session);
    return this.formatSessionResponse(updated);
  }

  /**
   * Delete/cancel a session (admin only).
   */
  async remove(id: string, userId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin'],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can delete sessions');
    }

    // If session was scheduled, cancel the reminder job
    if (session.status === SessionStatus.SCHEDULED) {
      try {
        const job = await this.sessionQueue.getJob(`reminder-${session.id}`);
        if (job) {
          await job.remove();
          this.logger.log(`Cancelled reminder job for session ${session.id}`);
        }
      } catch (err) {
        this.logger.warn(`Failed to cancel reminder job for session ${session.id}: ${err.message}`);
      }
    }

    // Soft cancel
    session.status = SessionStatus.CANCELLED;
    await this.sessionRepository.save(session);

    // Notify communications
    await this.notifyCommunications('session-cancelled', {
      roomId: session.room.id,
      sessionId: session.id,
    });

    return { message: 'Session cancelled successfully' };
  }

  /**
   * Start a session (transition SCHEDULED → LIVE). Host must manually trigger this.
   */
  async start(id: string, userId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'host'],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can start sessions');
    }

    if (session.status === SessionStatus.LIVE) {
      throw new BadRequestException('Session is already live');
    }

    if (session.status === SessionStatus.ENDED) {
      throw new BadRequestException('Session has already ended');
    }

    // Cancel pending reminder job if any
    try {
      const job = await this.sessionQueue.getJob(`reminder-${session.id}`);
      if (job) {
        await job.remove();
        this.logger.log(`Cancelled pending reminder job for session ${session.id}`);
      }
    } catch (err) {
      this.logger.error(`Failed to cancel reminder job: ${err.message}`);
    }

    session.status = SessionStatus.LIVE;
    session.startedAt = new Date();

    const updated = await this.sessionRepository.save(session);
    this.logger.log(`Session started: ${updated.id}`);

    // Ensure LiveKit room
    await this.livekitService.ensureSessionRoom(updated.id).catch((err) => {
      this.logger.error(`Failed to ensure LiveKit room for session ${updated.id}: ${err.message}`);
    });

    // Send started notifications
    await this.notificationService.createLiveSessionStartedNotifications(updated, userId).catch((err) => {
      this.logger.error(`Failed to send session-started notifications: ${err.message}`);
    });

    // Notify communications
    await this.notifyCommunications('session-started', {
      roomId: updated.room.id,
      sessionId: updated.id,
      status: updated.status,
    });

    return this.formatSessionResponse(updated);
  }

  /**
   * End a session (transition LIVE → ENDED). Calculates duration.
   */
  async end(id: string, userId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['room', 'room.admin', 'host', 'actingHost', 'attendees', 'attendees.user'],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const isRoomAdmin = session.room?.admin?.id === userId;
    const isHost = session.host?.id === userId;
    const isActingHost = session.actingHost?.id === userId;

    if (!isRoomAdmin && !isHost && !isActingHost) {
      throw new ForbiddenException('Only the host or acting host can end the session');
    }

    if (session.status !== SessionStatus.LIVE) {
      throw new BadRequestException('Can only end a live session');
    }

    return this.finalizeSession(session, 'manual', userId);
  }

  /**
   * Leave a live session. Marks attendee as having left and auto-ends if empty.
   */
  async leave(id: string, userId: string, dto: LeaveSessionDto = {}) {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['room', 'host', 'actingHost', 'attendees', 'attendees.user'],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status !== SessionStatus.LIVE) {
      return this.formatSessionResponse(session);
    }

    let attendee: SessionAttendee | null | undefined = session.attendees?.find((a) => a.user?.id === userId);
    if (!attendee) {
      attendee = await this.attendeeRepository.findOne({
        where: {
          session: { id: session.id },
          user: { id: userId },
        },
        relations: ['user'],
      });
    }

    if (!attendee) {
      this.logger.warn(`User ${userId} attempted to leave session ${id} without an attendee record`);
      return this.formatSessionResponse(session);
    }

    attendee.leftAt = new Date();
    await this.attendeeRepository.save(attendee);

    if (session.attendees) {
      session.attendees = session.attendees.map((existing) =>
        existing.id === attendee!.id ? { ...existing, leftAt: attendee!.leftAt } : existing,
      );
    }

    const resolveActingHost = (candidateId?: string | null) => {
      if (!candidateId) {
        return null;
      }
      const candidate = session.attendees?.find(
        (a) => !a.leftAt && a.user?.id === candidateId,
      );
      return candidate?.user ?? null;
    };

    let actingHostChanged = false;

    if (session.host?.id === userId) {
      if (dto.actingHostId) {
        const nextHost = resolveActingHost(dto.actingHostId);
        if (!nextHost) {
          throw new BadRequestException('Selected acting host must be an active attendee');
        }
        session.actingHost = nextHost;
      } else {
        session.actingHost = null;
      }
      actingHostChanged = true;
    } else if (session.actingHost?.id === userId) {
      if (dto.actingHostId) {
        const nextHost = resolveActingHost(dto.actingHostId);
        if (!nextHost) {
          throw new BadRequestException('Selected acting host must be an active attendee');
        }
        session.actingHost = nextHost;
      } else {
        session.actingHost = null;
      }
      actingHostChanged = true;
    } else if (dto.actingHostId) {
      const nextHost = resolveActingHost(dto.actingHostId);
      if (!nextHost) {
        throw new BadRequestException('Selected acting host must be an active attendee');
      }
      session.actingHost = nextHost;
      actingHostChanged = true;
    }

    if (actingHostChanged) {
      await this.sessionRepository.save(session);
    }

    const remainingAttendees = await this.attendeeRepository.count({
      where: {
        session: { id: session.id },
        leftAt: IsNull(),
      },
    });

    if (remainingAttendees === 0) {
      this.scheduleAutoEnd(session.id);
    } else {
      this.cancelAutoEnd(session.id);
    }

    this.logger.log(`User ${userId} left session ${id}`);

    const refreshed = await this.sessionRepository.findOne({
      where: { id: session.id },
      relations: ['room', 'host', 'actingHost', 'attendees', 'attendees.user'],
    });

    return this.formatSessionResponse(refreshed ?? session);
  }

  /**
   * Join a session (create SessionAttendee record).
   */
  async join(id: string, userId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['room', 'host', 'actingHost', 'attendees', 'attendees.user'],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status !== SessionStatus.LIVE) {
      throw new BadRequestException('Can only join a live session');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.attendeeRepository.findOne({
      where: {
        session: { id: session.id },
        user: { id: userId },
      },
    });

    if (existing) {
      existing.joinedAt = new Date();
      existing.leftAt = null;
      await this.attendeeRepository.save(existing);
    } else {
      const attendee = this.attendeeRepository.create({
        session,
        user,
        joinedAt: new Date(),
        leftAt: null,
      });
      await this.attendeeRepository.save(attendee);
    }

    if (session.host?.id === userId && session.actingHost) {
      session.actingHost = null;
      await this.sessionRepository.save(session);
    }

    this.cancelAutoEnd(session.id);

    this.logger.log(`User ${userId} joined session ${id}`);
    this.rewardsService.onAction(userId, ChallengeAction.LIVE_SESSION_ATTENDED).catch(() => {});

    const refreshed = await this.sessionRepository.findOne({
      where: { id: session.id },
      relations: ['room', 'host', 'actingHost', 'attendees', 'attendees.user'],
    });

    return this.formatSessionResponse(refreshed ?? session);
  }

  async kickAttendee(sessionId: string, hostUserId: string, targetUserId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['room', 'room.admin', 'host', 'attendees', 'attendees.user'],
    });

    if (!session) throw new NotFoundException('Session not found');
    if (session.host?.id !== hostUserId && (session.room?.admin as any)?.id !== hostUserId) {
      throw new BadRequestException('Only the host can kick attendees');
    }
    if (targetUserId === hostUserId) {
      throw new BadRequestException('Cannot kick yourself');
    }

    const attendee = session.attendees?.find((a) => a.user?.id === targetUserId && !a.leftAt);
    if (!attendee) {
      throw new NotFoundException('Attendee not found or already left');
    }

    attendee.leftAt = new Date();
    await this.attendeeRepository.save(attendee);

    this.logger.log(`Host ${hostUserId} kicked user ${targetUserId} from session ${sessionId}`);

    return { ok: true, kickedUserId: targetUserId };
  }

  async getAttendees(id: string) {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['attendees', 'attendees.user'],
    });
    if (!session) throw new NotFoundException('Session not found');

    return {
      sessionId: session.id,
      attendees: (session.attendees ?? []).map((a) => ({
        id: a.id,
        joinedAt: a.joinedAt,
        leftAt: a.leftAt,
        focusScore: a.focusScore,
        user: a.user
          ? {
              id: a.user.id,
              firstName: (a.user as any).firstName,
              lastName: (a.user as any).lastName,
              image: (a.user as any).image,
            }
          : null,
      })),
    };
  }

  async getSummary(id: string, userId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['room'],
    });
    if (!session) throw new NotFoundException('Session not found');
    return {
      sessionId: session.id,
      summaryText: session.summaryText ?? null,
      summaryPdfUrl: session.summaryPdfUrl ?? null,
    };
  }

  /**
   * Format session entity to API response.
   */
  private formatSessionResponse(session: LiveSession, attendeeCount?: number) {
    return {
      id: session.id,
      title: session.title,
      description: session.description,
      status: session.status,
      scheduledAt: session.scheduledAt,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMinutes: session.durationMinutes,
      createdAt: session.createdAt,
      host: session.host ? {
        id: session.host.id,
        firstName: (session.host as any).firstName,
        lastName: (session.host as any).lastName,
        image: (session.host as any).image,
      } : null,
      actingHost: session.actingHost ? {
        id: session.actingHost.id,
        firstName: (session.actingHost as any).firstName,
        lastName: (session.actingHost as any).lastName,
        image: (session.actingHost as any).image,
      } : null,
      room: session.room ? {
        id: session.room.id,
        title: session.room.title,
      } : null,
      summaryText: session.summaryText ?? null,
      summaryPdfUrl: session.summaryPdfUrl ?? null,
      attendeeCount: attendeeCount ?? session.attendees?.length ?? 0,
      attendees: session.attendees?.map(a => ({
        id: a.id,
        joinedAt: a.joinedAt,
        leftAt: a.leftAt,
        focusScore: a.focusScore,
        user: a.user ? {
          id: a.user.id,
          firstName: (a.user as any).firstName,
          lastName: (a.user as any).lastName,
          image: (a.user as any).image,
        } : null,
      })) || undefined,
    };
  }

  /**
   * Save a focus tracking report for a user in a session.
   */
  async saveFocusReport(sessionId: string, userId: string, dto: SaveFocusReportDto) {
    // Find the attendee record
    const attendee = await this.attendeeRepository.findOne({
      where: {
        session: { id: sessionId },
        user: { id: userId },
      },
      relations: ['session', 'user'],
    });

    if (!attendee) {
      throw new NotFoundException('You are not an attendee of this session');
    }

    // Update the attendee's focus score
    attendee.focusScore = dto.focusScore;
    await this.attendeeRepository.save(attendee);

    // Check for existing report (upsert)
    let report = await this.focusReportRepository.findOne({
      where: {
        session: { id: sessionId },
        user: { id: userId },
      },
    });

    if (report) {
      // Update existing
      report.focusScore = dto.focusScore;
      report.totalDurationMs = dto.totalDurationMs;
      report.focusedMs = dto.focusedMs;
      report.distractedMs = dto.distractedMs;
      report.noFaceMs = dto.noFaceMs;
      report.longestFocusedStreakMs = dto.longestFocusedStreakMs;
      report.trackingStartedAt = dto.trackingStartedAt;
      report.trackingEndedAt = dto.trackingEndedAt;
      report.events = dto.events;
    } else {
      // Create new
      report = this.focusReportRepository.create({
        session: attendee.session,
        user: attendee.user,
        focusScore: dto.focusScore,
        totalDurationMs: dto.totalDurationMs,
        focusedMs: dto.focusedMs,
        distractedMs: dto.distractedMs,
        noFaceMs: dto.noFaceMs,
        longestFocusedStreakMs: dto.longestFocusedStreakMs,
        trackingStartedAt: dto.trackingStartedAt,
        trackingEndedAt: dto.trackingEndedAt,
        events: dto.events,
      });
    }

    await this.focusReportRepository.save(report);
    this.logger.log(`Focus report saved for user ${userId} in session ${sessionId} (score: ${dto.focusScore})`);

    this.rewardsService.onAction(userId, ChallengeAction.FOCUS_SCORE, dto.focusScore).catch(() => {});
    return { ok: true, focusScore: dto.focusScore };
  }

  /**
   * Fetch the current user's focus report for a session, or null if none exists.
   * Used by the historical "View My Focus Report" flow on past session cards.
   */
  async getMyFocusReport(sessionId: string, userId: string) {
    const report = await this.focusReportRepository.findOne({
      where: {
        session: { id: sessionId },
        user: { id: userId },
      },
      relations: ['session', 'user'],
    });

    if (!report) {
      return { report: null };
    }

    return {
      report: {
        id: report.id,
        sessionId: report.session.id,
        userId: report.user.id,
        focusScore: report.focusScore,
        totalDurationMs: Number(report.totalDurationMs),
        focusedMs: Number(report.focusedMs),
        distractedMs: Number(report.distractedMs),
        noFaceMs: Number(report.noFaceMs),
        longestFocusedStreakMs: Number(report.longestFocusedStreakMs),
        trackingStartedAt: Number(report.trackingStartedAt),
        trackingEndedAt: Number(report.trackingEndedAt),
        events: report.events ?? [],
        createdAt: report.createdAt,
      },
    };
  }
}
