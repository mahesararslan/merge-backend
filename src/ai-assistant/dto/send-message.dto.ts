import { IsString, IsOptional, IsInt, Min, Max, MinLength, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

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
}
