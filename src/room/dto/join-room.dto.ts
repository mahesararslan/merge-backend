import { IsString, Length } from 'class-validator';

export class JoinRoomDto {
  @IsString()
  @Length(6, 6, { message: 'Room code must be exactly 6 characters' })
  roomCode: string;
}