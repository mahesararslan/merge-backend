import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

@Injectable()
export class LiveSessionService {
  private readonly logger = new Logger(LiveSessionService.name);

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
  ) {}

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
      relations: ['room', 'host', 'attendees', 'attendees.user'],
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
      relations: ['room', 'room.admin', 'host'],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.room.admin.id !== userId) {
      throw new ForbiddenException('Only room admin can end sessions');
    }

    if (session.status !== SessionStatus.LIVE) {
      throw new BadRequestException('Can only end a live session');
    }

    session.status = SessionStatus.ENDED;
    session.endedAt = new Date();

    // Calculate duration in minutes
    if (session.startedAt) {
      const durationMs = session.endedAt.getTime() - session.startedAt.getTime();
      session.durationMinutes = Math.round(durationMs / (1000 * 60));
    }

    const updated = await this.sessionRepository.save(session);
    this.logger.log(`Session ended: ${updated.id}, duration: ${updated.durationMinutes}m`);
    return this.formatSessionResponse(updated);
  }

  /**
   * Join a session (create SessionAttendee record).
   */
  async join(id: string, userId: string) {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['room', 'host'],
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

    // Check if already joined
    const existing = await this.attendeeRepository.findOne({
      where: {
        session: { id: session.id },
        user: { id: userId },
      },
    });

    if (existing) {
      // Update joinedAt if re-joining
      existing.joinedAt = new Date();
      delete (existing as any).leftAt;
      await this.attendeeRepository.save(existing);
      return this.formatSessionResponse(session);
    }

    // Create new attendee record
    const attendee = this.attendeeRepository.create({
      session,
      user,
      joinedAt: new Date(),
    });

    await this.attendeeRepository.save(attendee);
    this.logger.log(`User ${userId} joined session ${id}`);
    return this.formatSessionResponse(session);
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
      room: session.room ? {
        id: session.room.id,
        title: session.room.title,
      } : null,
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
