import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST') || 'localhost',
          port: parseInt(configService.get('REDIS_PORT') || '6379'),
          password: configService.get('REDIS_PASSWORD'),
          maxRetriesPerRequest: 3,
          enableReadyCheck: false,
          connectTimeout: 10000,
          retryStrategy: (times: number) => {
            if (times > 3) return null;
            return Math.min(times * 200, 2000);
          },
        },
        prefix: 'bull',
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      }),
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
