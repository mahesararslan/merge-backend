import { IsString, IsArray, IsOptional, IsInt, Min, Max, MinLength, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAiDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  query: string;

  @IsArray()
  @IsString({ each: true })
  roomIds: string[];

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
