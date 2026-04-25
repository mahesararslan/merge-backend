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
          keepAlive: 30000,
          family: 4,
          connectTimeout: 30000,
          retryStrategy: (times: number) => {
            return Math.min(times * 100, 5000);
          },
        };

        if (url?.startsWith('rediss://') || (!url && host && port === 6379 && password)) {
           commonOptions.tls = { rejectUnauthorized: false };
        }

        return {
          createClient: (type: 'client' | 'subscriber' | 'bclient') => {
            const client = url 
              ? new Redis(url, commonOptions)
              : new Redis({ host, port, ...(password && { password }), ...commonOptions });
            
            client.on('error', (err) => {
              if (err.message?.includes('max retries')) return;
              new Logger('BullRedis').error(`Queue Redis Error (${type}): ${err.message}`);
            });
            return client;
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
