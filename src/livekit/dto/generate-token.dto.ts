import { IsUUID } from 'class-validator';

export class GenerateTokenDto {
  @IsUUID('4')
  roomId: string;

  @IsUUID('4')
  sessionId: string;
}
