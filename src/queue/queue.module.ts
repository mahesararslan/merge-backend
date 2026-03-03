import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Shared Redis client instance to reduce connections
let sharedRedisClient: any = null;

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        // Only create one Redis client and reuse it
        if (!sharedRedisClient) {
          const Redis = require('ioredis');
          sharedRedisClient = new Redis({
            host: configService.get('REDIS_HOST') || 'localhost',
            port: parseInt(configService.get('REDIS_PORT') || '6379'),
            password: configService.get('REDIS_PASSWORD'),
            maxRetriesPerRequest: 3,
            enableReadyCheck: false,
            lazyConnect: false,
            // Connection pooling settings
            retryStrategy: (times: number) => {
              const delay = Math.min(times * 50, 2000);
              return delay;
            },
          });
        }
        
        return {
          redis: {
            host: configService.get('REDIS_HOST') || 'localhost',
            port: parseInt(configService.get('REDIS_PORT') || '6379'),
            password: configService.get('REDIS_PASSWORD'),
            maxRetriesPerRequest: 3,
            enableReadyCheck: false,
            enableOfflineQueue: true,
          },
          prefix: 'bull', // Prefix all queue keys
        };
      },
      inject: [ConfigService],
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
  ],
  exports: [BullModule],
})
export class QueueModule {}
