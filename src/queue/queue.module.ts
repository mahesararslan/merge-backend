import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = parseInt(configService.get('REDIS_PORT', '6379'));
        const password = configService.get<string>('REDIS_PASSWORD');

        const commonOptions: any = {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          connectTimeout: 20000,
          retryStrategy: (times: number) => {
            return Math.min(times * 200, 5000);
          },
        };

        if (url?.startsWith('rediss://') || (!url && host && port === 6379 && password)) {
           commonOptions.tls = { rejectUnauthorized: false };
        }

        return {
          // We use createClient to ensure EVERY connection (client, sub, bclient)
          // gets the exact same robust configuration required for Upstash.
          createClient: (type: 'client' | 'subscriber' | 'bclient') => {
            if (url) {
              return new Redis(url, commonOptions);
            }
            return new Redis({
              host,
              port,
              ...(password && { password }),
              ...commonOptions,
            });
          },
          prefix: 'bull',
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 200,
          },
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
    BullModule.registerQueue({
      name: 'live-sessions',
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
