import { IsString, IsOptional, MaxLength, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateGeneralChatMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentDto)
  attachments?: AttachmentDto[];

}

export class AttachmentDto {
  @IsString()
  name: string;

  @IsString()
  url: string;
}
