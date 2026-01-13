import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';

export class CreateGeneralChatMessageDto {
  @IsUUID('4')
  roomId: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @IsOptional()
  @IsString()
  attachmentURL?: string;

  @IsOptional()
  @IsUUID('4')
  replyToId?: string;
}
