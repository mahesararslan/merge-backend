import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @IsUUID('4')
  recipientId: string;

  @IsString()
  @MaxLength(5000)
  content: string;

  @IsOptional()
  @IsString()
  attachmentURL?: string;

  @IsOptional()
  @IsUUID('4')
  replyToId?: string;
}
