import { IsString, IsOptional, IsInt, Min, Max, MinLength, MaxLength, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { AttachmentType } from '../../entities/ai-conversation.entity';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message: string;

  @IsOptional()
  @IsString()
  contextFileId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  topK?: number;

  // File attachment fields (for file-as-context feature)
  @IsOptional()
  @IsString()
  attachmentS3Url?: string;

  @IsOptional()
  @IsEnum(AttachmentType)
  attachmentType?: AttachmentType;

  @IsOptional()
  @IsString()
  attachmentOriginalName?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  attachmentFileSize?: number; // In bytes
}
