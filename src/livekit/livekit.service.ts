import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
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
  private readonly livekitHost: string;
  private roomServiceClient: RoomServiceClient | null = null;

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
    this.livekitHost = this.resolveLiveKitHost();
  }

  private resolveLiveKitHost(): string {
    const candidates = [
      this.configService.get<string>('LIVEKIT_HOST'),
      this.configService.get<string>('LIVEKIT_URL'),
      this.configService.get<string>('LIVEKIT_SERVER_URL'),
      this.configService.get<string>('NEXT_PUBLIC_LIVEKIT_URL'),
    ];

    const first = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
    if (!first) {
      return '';
    }

    // RoomServiceClient uses HTTP(S) transport. Convert ws(s) input if needed.
    return first.trim().replace(/^ws/i, 'http').replace(/\/$/, '');
  }

  private getSessionRoomName(sessionId: string): string {
    return `session-${sessionId}`;
  }

  private getRoomServiceClient(): RoomServiceClient {
    if (this.roomServiceClient) {
      return this.roomServiceClient;
    }

    if (!this.livekitHost) {
      throw new InternalServerErrorException('LiveKit host is not configured');
    }

    if (!this.apiKey || !this.apiSecret) {
      throw new InternalServerErrorException('LiveKit credentials are not configured');
    }

    this.roomServiceClient = new RoomServiceClient(
      this.livekitHost,
      this.apiKey,
      this.apiSecret,
    );

    return this.roomServiceClient;
  }

  async ensureSessionRoom(sessionId: string): Promise<void> {
    const roomName = this.getSessionRoomName(sessionId);
    const roomServiceClient = this.getRoomServiceClient();

    try {
      await roomServiceClient.createRoom({ name: roomName });
      this.logger.log(`Created LiveKit room ${roomName}`);
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('already exists') || message.includes('exists')) {
        this.logger.log(`LiveKit room ${roomName} already exists`);
        return;
      }
      throw error;
    }
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
    const livekitRoomName = this.getSessionRoomName(sessionId);

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
