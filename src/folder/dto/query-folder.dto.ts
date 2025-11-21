import { IsOptional, IsIn, IsUUID, IsEnum } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { FolderType } from '../../entities/folder.entity';

export class QueryFolderDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['name', 'createdAt', 'updatedAt'])
  sortBy?: string = 'name';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @Transform(({ value }) => value.toUpperCase())
  sortOrder?: 'ASC' | 'DESC' = 'ASC';

  @IsOptional()
  search?: string;

  @IsOptional()
  @IsEnum(FolderType)
  type?: FolderType;

  @IsOptional()
  @IsUUID('4')
  roomId?: string;

  @IsOptional()
  @IsUUID('4')
  parentFolderId?: string;
}