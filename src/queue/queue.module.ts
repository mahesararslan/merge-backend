import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL');
        const redisOptions: any = {
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          connectTimeout: 15000,
          retryStrategy: (times: number) => {
            return Math.min(times * 200, 5000);
          },
        };

        if (url?.startsWith('rediss://')) {
          redisOptions.tls = { rejectUnauthorized: false };
        }

        if (url) {
          // If URL is provided, we pass it as the first argument to Bull (via 'redis' property)
          // NestJS Bull handles passing this string + redisOptions to ioredis.
          return {
            redis: url,
            ...redisOptions,
            prefix: 'bull',
            defaultJobOptions: {
              removeOnComplete: 100,
              removeOnFail: 200,
            },
          };
        }

        return {
          redis: {
            host: configService.get('REDIS_HOST') || 'localhost',
            port: parseInt(configService.get('REDIS_PORT') || '6379'),
            password: configService.get('REDIS_PASSWORD'),
            ...redisOptions,
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
