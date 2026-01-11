import { IsString, IsOptional, MaxLength } from 'class-validator';

export class UpdateMessageDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  content?: string;

  @IsOptional()
  @IsString()
  attachmentURL?: string;
}
