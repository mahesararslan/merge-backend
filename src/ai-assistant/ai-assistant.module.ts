import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AiAssistantService } from './ai-assistant.service';
import { AiAssistantController } from './ai-assistant.controller';
import { AiConversation } from '../entities/ai-conversation.entity';
import { AiChatMessage } from '../entities/ai-chat-message.entity';
import { User } from '../entities/user.entity';
import { RoomModule } from '../room/room.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiConversation,
      AiChatMessage,
      User,
    ]),
    ConfigModule,
    RoomModule,
  ],
  controllers: [AiAssistantController],
  providers: [AiAssistantService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}

