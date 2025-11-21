import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAllRoomsDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'Search term cannot exceed 100 characters' })
  search?: string;
}