import { IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryUserFeedDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;
}