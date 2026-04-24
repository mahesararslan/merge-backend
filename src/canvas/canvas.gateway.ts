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
import { CanvasPermissionService } from './canvas-permission.service';

interface CanvasSocket extends Socket {
  userId?: string;
  sessionId?: string;
}

@WebSocketGateway({ namespace: '/canvas', cors: { origin: '*', credentials: true } })
export class CanvasGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CanvasGateway.name);

  constructor(
    private readonly permissionService: CanvasPermissionService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(client: CanvasSocket) {
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      this.logger.warn('Canvas WS: no token, disconnecting');
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      client.userId = payload.sub || payload.id;
    } catch {
      this.logger.warn('Canvas WS: invalid token, disconnecting');
      client.disconnect();
    }
  }

  async handleDisconnect(client: CanvasSocket) {
    if (client.sessionId && client.userId) {
      const hadDraw = await this.permissionService.canDraw(client.sessionId, client.userId);
      const isHost = await this.permissionService.isHost(client.sessionId, client.userId);

      if (hadDraw && !isHost) {
        await this.permissionService.revokeDraw(client.sessionId, client.userId);
        const drawers = await this.permissionService.getDrawers(client.sessionId);
        this.server.to(client.sessionId).emit('drawPermissionChanged', {
          userId: client.userId,
          canDraw: false,
          drawers,
        });
        this.logger.log(`Auto-freed draw slot for ${client.userId} in ${client.sessionId}`);
      }
    }
  }

  @SubscribeMessage('joinCanvas')
  async handleJoinCanvas(
    @ConnectedSocket() client: CanvasSocket,
    @MessageBody() data: { sessionId: string; isHost?: boolean },
  ) {
    if (!client.userId) return;

    client.sessionId = data.sessionId;
    client.join(data.sessionId);

    if (data.isHost) {
      await this.permissionService.setHost(data.sessionId, client.userId);
    }

    const canDraw = await this.permissionService.canDraw(data.sessionId, client.userId);
    const drawers = await this.permissionService.getDrawers(data.sessionId);

    client.emit('canvasPermissions', { canDraw, drawers });
    this.logger.log(`${client.userId} joined canvas room ${data.sessionId} (canDraw=${canDraw})`);
  }

  @SubscribeMessage('grantDraw')
  async handleGrantDraw(
    @ConnectedSocket() client: CanvasSocket,
    @MessageBody() data: { sessionId: string; targetUserId: string },
  ) {
    if (!client.userId) return;

    const isHost = await this.permissionService.isHost(data.sessionId, client.userId);
    if (!isHost) {
      client.emit('canvasError', { message: 'Only the host can grant draw permissions.' });
      return;
    }

    const result = await this.permissionService.grantDraw(data.sessionId, data.targetUserId);
    if (!result.ok) {
      client.emit('canvasError', { message: result.reason });
      return;
    }

    const drawers = await this.permissionService.getDrawers(data.sessionId);
    this.server.to(data.sessionId).emit('drawPermissionChanged', {
      userId: data.targetUserId,
      canDraw: true,
      drawers,
    });
  }

  @SubscribeMessage('revokeDraw')
  async handleRevokeDraw(
    @ConnectedSocket() client: CanvasSocket,
    @MessageBody() data: { sessionId: string; targetUserId: string },
  ) {
    if (!client.userId) return;

    const isHost = await this.permissionService.isHost(data.sessionId, client.userId);
    if (!isHost) {
      client.emit('canvasError', { message: 'Only the host can revoke draw permissions.' });
      return;
    }

    await this.permissionService.revokeDraw(data.sessionId, data.targetUserId);
    const drawers = await this.permissionService.getDrawers(data.sessionId);
    this.server.to(data.sessionId).emit('drawPermissionChanged', {
      userId: data.targetUserId,
      canDraw: false,
      drawers,
    });
  }
}
