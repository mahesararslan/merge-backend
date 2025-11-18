import { IsOptional, IsString, IsIn } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class QueryNoteDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  folderId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'title'])
  sortBy?: string = 'updatedAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @Transform(({ value }) => value.toUpperCase())
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}