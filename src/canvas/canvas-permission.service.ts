import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const MAX_DRAWERS = 5;
const DRAWERS_KEY = (sid: string) => `canvas:drawers:${sid}`;
const HOST_KEY = (sid: string) => `canvas:host:${sid}`;

@Injectable()
export class CanvasPermissionService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;
  private readonly logger = new Logger(CanvasPermissionService.name);

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD', '');

    this.redis = new Redis({
      host,
      port,
      ...(password && { password }),
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy: (times: number) => Math.min(times * 200, 2000),
    });

    this.redis.on('ready', () => this.logger.log('Canvas Redis connected'));
    this.redis.on('error', (err) => this.logger.error('Canvas Redis error', err.message));
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log('Canvas Redis connection closed');
    }
  }

  async setHost(sessionId: string, hostUserId: string): Promise<void> {
    await this.redis.set(HOST_KEY(sessionId), hostUserId);
  }

  async getHost(sessionId: string): Promise<string | null> {
    return this.redis.get(HOST_KEY(sessionId));
  }

  async isHost(sessionId: string, userId: string): Promise<boolean> {
    const host = await this.getHost(sessionId);
    return host === userId;
  }

  async grantDraw(sessionId: string, userId: string): Promise<{ ok: boolean; reason?: string }> {
    const isAlready = await this.redis.sismember(DRAWERS_KEY(sessionId), userId);
    if (isAlready) return { ok: true };

    const count = await this.redis.scard(DRAWERS_KEY(sessionId));
    if (count >= MAX_DRAWERS) {
      return { ok: false, reason: 'Maximum active drawers reached. Remove someone first.' };
    }

    await this.redis.sadd(DRAWERS_KEY(sessionId), userId);
    this.logger.log(`Granted draw to ${userId} in session ${sessionId} (${count + 1}/${MAX_DRAWERS})`);
    return { ok: true };
  }

  async revokeDraw(sessionId: string, userId: string): Promise<void> {
    await this.redis.srem(DRAWERS_KEY(sessionId), userId);
    this.logger.log(`Revoked draw from ${userId} in session ${sessionId}`);
  }

  async canDraw(sessionId: string, userId: string): Promise<boolean> {
    const host = await this.getHost(sessionId);
    if (host === userId) return true;
    const isMember = await this.redis.sismember(DRAWERS_KEY(sessionId), userId);
    return isMember === 1;
  }

  async getDrawers(sessionId: string): Promise<string[]> {
    return this.redis.smembers(DRAWERS_KEY(sessionId));
  }

  async getDrawerCount(sessionId: string): Promise<number> {
    return this.redis.scard(DRAWERS_KEY(sessionId));
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.redis.del(DRAWERS_KEY(sessionId), HOST_KEY(sessionId));
    this.logger.log(`Cleared canvas permissions for session ${sessionId}`);
  }
}
