import { IsString, IsUUID, IsOptional, MaxLength, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGeneralChatMessageDto {
  @IsUUID('4')
  roomId: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

  @IsOptional()
  @IsUUID('4')
  replyToId?: string;
}

export class AttachmentDto {
  @IsString()
  name: string;

  @IsString()
  url: string;
}
