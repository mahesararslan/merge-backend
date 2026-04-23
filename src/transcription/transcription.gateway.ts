import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { TranscriptionService } from './transcription.service';

interface AuthSocket extends Socket {
  userId?: string;
  sessionId?: string;
}

@WebSocketGateway({ namespace: '/transcription', cors: { origin: '*', credentials: true } })
export class TranscriptionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TranscriptionGateway.name);

  constructor(
    private readonly transcriptionService: TranscriptionService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: AuthSocket) {
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      this.logger.warn('Transcription WS: no token, disconnecting');
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      client.userId = payload.sub || payload.id;
    } catch {
      this.logger.warn('Transcription WS: invalid token, disconnecting');
      client.disconnect();
    }
  }

  handleDisconnect(client: AuthSocket) {
    if (client.sessionId) {
      this.logger.log(`Client disconnected, cleaning up session ${client.sessionId}`);
    }
  }

  @SubscribeMessage('startTranscription')
  handleStart(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { sessionId: string },
  ) {
    if (!client.userId) return;
    client.sessionId = data.sessionId;
    this.transcriptionService.startSession(data.sessionId);
    this.logger.log(`Transcription started: session=${data.sessionId} user=${client.userId}`);
  }

  private chunkCounts = new Map<string, number>();

  @SubscribeMessage('audioChunk')
  handleAudioChunk(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: Buffer | ArrayBuffer,
  ) {
    if (!client.sessionId) return;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const count = (this.chunkCounts.get(client.sessionId) ?? 0) + 1;
    this.chunkCounts.set(client.sessionId, count);
    if (count === 1 || count % 50 === 0) {
      this.logger.log(`Audio chunks received for session ${client.sessionId}: ${count} (latest ${buffer.byteLength}b)`);
    }
    this.transcriptionService.sendAudio(client.sessionId, buffer);
  }

  @SubscribeMessage('stopTranscription')
  async handleStop(
    @ConnectedSocket() client: AuthSocket,
    @MessageBody() data: { sessionId: string },
  ) {
    if (!client.userId) return;
    this.logger.log(`Stop transcription requested for session ${data.sessionId}`);
  }
}
