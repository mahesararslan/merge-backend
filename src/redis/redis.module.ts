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
        const url = configService.get<string>('REDIS_URL');
        const options: any = {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        };

        if (url?.startsWith('rediss://')) {
          options.tls = { rejectUnauthorized: false };
        }

        let client: Redis;
        if (url) {
          client = new Redis(url, options);
        } else {
          client = new Redis({
            host: configService.get('REDIS_HOST') || 'localhost',
            port: parseInt(configService.get('REDIS_PORT') || '6379'),
            password: configService.get('REDIS_PASSWORD'),
            ...options,
          });
        }

        client.on('error', (err) => logger.error('Redis Client Error', err));
        client.on('ready', () => logger.log('Redis Client Ready'));
        return client;
      },
      inject: [ConfigService],
    },
    {
      provide: 'REDIS_SUBSCRIBER',
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        const options: any = {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        };

        if (url?.startsWith('rediss://')) {
          options.tls = { rejectUnauthorized: false };
        }

        let subscriber: Redis;
        if (url) {
          subscriber = new Redis(url, options);
        } else {
          subscriber = new Redis({
            host: configService.get('REDIS_HOST') || 'localhost',
            port: parseInt(configService.get('REDIS_PORT') || '6379'),
            password: configService.get('REDIS_PASSWORD'),
            ...options,
          });
        }

        subscriber.on('error', (err) =>
          logger.error('Redis Subscriber Error', err),
        );
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
