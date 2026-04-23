import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger, OnModuleDestroy } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { LiveSession, SessionStatus } from '../entities/live-video-session.entity';
import { SessionAttendee } from '../entities/live-video-sesssion-attendee.entity';
import { Room } from '../entities/room.entity';
import { User } from '../entities/user.entity';
import { RoomMember } from '../entities/room-member.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { QuerySessionDto } from './dto/query-session.dto';
import { CalendarService } from '../calendar/calendar.service';
import { TaskCategory } from '../entities/calendar-event.entity';
import { LeaveSessionDto } from './dto/leave-session.dto';
import { TranscriptionService } from '../transcription/transcription.service';

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
    private calendarService: CalendarService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly transcriptionService: TranscriptionService,
  ) {
    this.communicationServiceUrl =
      this.configService.get<string>('COMMUNICATION_SERVICE_URL') ||
      this.configService.get<string>('COMMUNICATION_URL') ||
      'http://localhost:3001';

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

    this.processTranscriptionAsync(updated).catch((err) => {
      this.logger.error(`Post-session transcription failed for ${updated.id}: ${err?.message}`);
    });

    return this.formatSessionResponse(updated);
  }

  private async processTranscriptionAsync(session: LiveSession): Promise<void> {
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

    const payload = {
      roomId: sessionWithRoom.room.id,
      sessionId: sessionWithRoom.id,
      reason,
      endedAt: sessionWithRoom.endedAt?.toISOString(),
      endedBy,
    };

    try {
      const headers: Record<string, string> = {};
      const internalSecret = this.configService.get<string>('INTERNAL_SERVICE_SECRET');
      if (internalSecret) {
        headers['x-internal-secret'] = internalSecret;
      }

      await firstValueFrom(
        this.httpService.post(
          `${this.communicationServiceUrl}/internal/live-session-ended`,
          payload,
          { headers },
        ),
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to notify communications about session ${session.id} end: ${error?.message || 'Unknown error'}`,
      );
    }
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
      }, room.id);
    } catch (error: any) {
      this.logger.error(`Failed to create calendar events: ${error.message}`);
      // Don't fail the session creation if calendar fails
    }

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

    await this.sessionRepository.remove(session);
    return { message: 'Session deleted successfully' };
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

    session.status = SessionStatus.LIVE;
    session.startedAt = new Date();

    const updated = await this.sessionRepository.save(session);
    this.logger.log(`Session started: ${updated.id}`);
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

    const refreshed = await this.sessionRepository.findOne({
      where: { id: session.id },
      relations: ['room', 'host', 'actingHost', 'attendees', 'attendees.user'],
    });

    return this.formatSessionResponse(refreshed ?? session);
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
}
