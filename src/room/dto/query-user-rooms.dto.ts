import { IsOptional, IsIn } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export enum RoomFilter {
  JOINED = 'joined',
  CREATED = 'created',
  ALL = 'all',
}

export class QueryUserRoomsDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['title', 'createdAt', 'updatedAt'])
  sortBy?: string = 'updatedAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @Transform(({ value }) => value.toUpperCase())
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  @IsIn(['joined', 'created', 'all'])
  filter?: RoomFilter = RoomFilter.ALL;

  @IsOptional()
  search?: string;
}