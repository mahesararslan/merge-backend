import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import dbConfig from './config/db.config';
import dbConfigProduction from './config/db.config.production';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { CacheModule } from '@nestjs/cache-manager';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TagModule } from './tag/tag.module';
import { RoomModule } from './room/room.module';
import { NoteModule } from './note/note.module';
import { FolderModule } from './folder/folder.module';
import { FileModule } from './file/file.module';
import { QuizModule } from './quiz/quiz.module';
import { AssignmentModule } from './assignment/assignment.module';
import { DirectMessageModule } from './direct-message/direct-message.module';
import { GeneralChatModule } from './general-chat/general-chat.module';
import { AnnouncementModule } from './announcement/announcement.module';
import { NotificationModule } from './notification/notification.module';
import { FirebaseModule } from './firebase/firebase.module';
import { QueueModule } from './queue/queue.module';
import { CalendarModule } from './calendar/calendar.module';
import { AiAssistantModule } from './ai-assistant/ai-assistant.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      load: [dbConfig, dbConfigProduction],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () =>
        process.env.NODE_ENV === 'development'
          ? dbConfig()
          : dbConfigProduction(),
    }),
    CacheModule.register({
      isGlobal: true, // makes cache available app-wide
      ttl: 0, // no cache for now.
      max: 1000, // maximum number of items in cache
    }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: 60 * 1000, // Time to live for each request in milliseconds which in this case is 1 minute
          limit: 1000, // Maximum number of requests allowed within the TTL
        }, 
      ],
    }),
    UserModule,
    AuthModule,
    MailModule,
    TagModule,
    RoomModule,
    NoteModule,
    FolderModule,
    FileModule,
    QuizModule,
    AssignmentModule,
    DirectMessageModule,
    GeneralChatModule,
    FirebaseModule,
    QueueModule,
    AnnouncementModule,
    NotificationModule,
    CalendarModule,
    AiAssistantModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
