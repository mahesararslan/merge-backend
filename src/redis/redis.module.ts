import { Module, Global, Logger, OnApplicationShutdown, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const logger = new Logger('RedisModule');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const host = configService.get('REDIS_HOST') || 'localhost';
        const port = parseInt(configService.get('REDIS_PORT') || '6379');
        const password = configService.get('REDIS_PASSWORD');
        const client = new Redis({
          host,
          port,
          ...(password && { password }),
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        client.on('error', (err) => logger.error('Redis Client Error', err));
        client.on('ready', () => logger.log('Redis Client Ready'));
        return client;
      },
      inject: [ConfigService],
    },
    {
      provide: 'REDIS_SUBSCRIBER',
      useFactory: (configService: ConfigService) => {
        const host = configService.get('REDIS_HOST') || 'localhost';
        const port = parseInt(configService.get('REDIS_PORT') || '6379');
        const password = configService.get('REDIS_PASSWORD');
        const subscriber = new Redis({
          host,
          port,
          ...(password && { password }),
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        subscriber.on('error', (err) => logger.error('Redis Subscriber Error', err));
        subscriber.on('ready', () => logger.log('Redis Subscriber Ready'));
        return subscriber;
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT', 'REDIS_SUBSCRIBER'],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(
    @Inject('REDIS_CLIENT') private readonly client: Redis,
    @Inject('REDIS_SUBSCRIBER') private readonly subscriber: Redis,
  ) {}

  async onApplicationShutdown() {
    logger.log('Closing Redis connections...');
    if (this.client) {
      await this.client.quit();
    }
    if (this.subscriber) {
      await this.subscriber.quit();
    }
  }
}
