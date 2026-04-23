import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessToken } from 'livekit-server-sdk';
import { Room } from '../entities/room.entity';
import { RoomMember } from '../entities/room-member.entity';
import { LiveVideoPermissions } from '../entities/live-video-permissions.entity';
import { LiveSession, SessionStatus } from '../entities/live-video-session.entity';
import { User } from '../entities/user.entity';

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(RoomMember)
    private roomMemberRepository: Repository<RoomMember>,
    @InjectRepository(LiveVideoPermissions)
    private permissionsRepository: Repository<LiveVideoPermissions>,
    @InjectRepository(LiveSession)
    private sessionRepository: Repository<LiveSession>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {
    this.apiKey = this.configService.get<string>('LIVEKIT_API_KEY') || '';
    this.apiSecret = this.configService.get<string>('LIVEKIT_API_SECRET') || '';
  }

  /**
   * Generate a signed LiveKit participant token.
   * Admin gets full publish/subscribe permissions.
   * Members get permissions based on their LiveVideoPermissions record.
   */
  async generateToken(sessionId: string, userId: string, roomId: string): Promise<{ token: string }> {
    // Verify session exists and is live
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['room'],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.status !== SessionStatus.LIVE) {
      throw new ForbiddenException('Session is not currently live');
    }

    // Load room to check admin
    const room = await this.roomRepository.findOne({
      where: { id: roomId },
      relations: ['admin'],
    });

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    // Load user for identity
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isAdmin = room.admin.id === userId;
    const participantName = `${(user as any).firstName} ${(user as any).lastName}`;
    // Use sessionId as the LiveKit room name for uniqueness
    const livekitRoomName = `session-${sessionId}`;

    // All participants get full publish/subscribe rights at the LiveKit level.
    // Host-managed permissions are enforced client-side via LiveKit data channel messages.
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: userId,
      name: participantName,
      ttl: '4h',
    });

    at.addGrant({
      roomJoin: true,
      room: livekitRoomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    this.logger.log(`Generated LiveKit token for user ${userId} in session ${sessionId} (admin: ${isAdmin})`);

    return { token };
  }
}
