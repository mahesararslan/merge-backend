import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeneralChatService } from './general-chat.service';
import { GeneralChatController } from './general-chat.controller';
import { GeneralChatMessage } from '../entities/general-chat-message.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { RoomMember } from '../entities/room-member.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([GeneralChatMessage, User, Room, RoomMember]),
  ],
  controllers: [GeneralChatController],
  providers: [GeneralChatService],
  exports: [GeneralChatService],
})
export class GeneralChatModule {}
