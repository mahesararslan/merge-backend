import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AiAssistantService } from './ai-assistant.service';
import { AiAssistantController } from './ai-assistant.controller';
import { AiConversation } from '../entities/ai-conversation.entity';
import { AiChatMessage } from '../entities/ai-chat-message.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { RoomMember } from '../entities/room-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiConversation,
      AiChatMessage,
      User,
      Room,
      RoomMember,
    ]),
    ConfigModule,
  ],
  controllers: [AiAssistantController],
  providers: [AiAssistantService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}

