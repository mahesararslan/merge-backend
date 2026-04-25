import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService, redisClient: Redis, redisSubscriber: Redis) => ({
        createClient: (type: 'client' | 'subscriber' | 'bclient') => {
          switch (type) {
            case 'client':
              return redisClient;
            case 'subscriber':
              return redisSubscriber;
            case 'bclient':
              return new Redis({
                host: configService.get('REDIS_HOST') || 'localhost',
                port: parseInt(configService.get('REDIS_PORT') || '6379'),
                password: configService.get('REDIS_PASSWORD'),
                maxRetriesPerRequest: null,
                enableReadyCheck: false,
                retryStrategy: (times) => Math.min(times * 200, 2000),
              });
            default:
              return new Redis({
                host: configService.get('REDIS_HOST') || 'localhost',
                port: parseInt(configService.get('REDIS_PORT') || '6379'),
                password: configService.get('REDIS_PASSWORD'),
                maxRetriesPerRequest: null,
                enableReadyCheck: false,
                retryStrategy: (times) => Math.min(times * 200, 2000),
              });
          }
        },
        prefix: 'bull',
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      }),
      inject: [ConfigService, 'REDIS_CLIENT', 'REDIS_SUBSCRIBER'],
    }),
    BullModule.registerQueue({
      name: 'announcements',
    }),
    BullModule.registerQueue({
      name: 'assignments',
    }),
    BullModule.registerQueue({
      name: 'quizzes',
    }),
    BullModule.registerQueue({
      name: 'calendar',
    }),
    BullModule.registerQueue({
      name: 'live-sessions',
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
