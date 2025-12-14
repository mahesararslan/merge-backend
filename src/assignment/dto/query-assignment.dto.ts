import { IsOptional, IsIn, IsUUID } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryAssignmentDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['title', 'createdAt', 'startAt', 'endAt'])
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @Transform(({ value }) => value?.toUpperCase())
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  search?: string;

  @IsOptional()
  @IsUUID('4')
  roomId?: string;
}
