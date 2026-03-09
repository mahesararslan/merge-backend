import { IsOptional, IsString, IsArray } from 'class-validator';
import { Type, Transform } from 'class-transformer';

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

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') return value.split(',').map((t: string) => t.trim()).filter(Boolean);
    if (Array.isArray(value)) return value;
    return [];
  })
  @IsArray()
  userTags?: string[];
}