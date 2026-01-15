import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { User } from 'src/entities/user.entity';
import { UserAuth } from 'src/entities/user-auth.entity';
import { FcmToken } from 'src/entities/fcm-token.entity';
import { TagModule } from 'src/tag/tag.module';
import { RoomModule } from 'src/room/room.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserAuth, FcmToken]),
    TagModule,
    RoomModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}