// src/file/dto/query-file.dto.ts
import { IsOptional, IsIn, IsUUID, IsEnum } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { FileType } from '../../entities/file.entity';

export class QueryFileDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['originalName', 'size', 'createdAt', 'updatedAt'])
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @Transform(({ value }) => value.toUpperCase())
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  @IsUUID('4')
  folderId?: string;

  @IsOptional()
  @IsUUID('4')
  roomId?: string;

  @IsOptional()
  @IsEnum(FileType)
  type?: FileType;

  @IsOptional()
  search?: string;
}