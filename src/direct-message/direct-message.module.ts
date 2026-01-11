import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DirectMessageService } from './direct-message.service';
import { DirectMessageController } from './direct-message.controller';
import { Message } from '../entities/message.entity';
import { User } from '../entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Message, User])],
  controllers: [DirectMessageController],
  providers: [DirectMessageService],
  exports: [DirectMessageService],
})
export class DirectMessageModule {}
