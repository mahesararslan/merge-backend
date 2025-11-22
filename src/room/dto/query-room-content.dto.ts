// src/room/dto/query-room-content.dto.ts
import { IsOptional, IsIn, IsUUID } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class QueryRoomContentDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['name', 'title', 'createdAt', 'updatedAt'])
  sortBy?: string = 'updatedAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @Transform(({ value }) => value.toUpperCase())
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  search?: string;

  @IsOptional()
  @IsUUID('4')
  folderId?: string;
}