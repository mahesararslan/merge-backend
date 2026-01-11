import { IsOptional, IsIn, IsUUID } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryAttemptsDto {
  @IsUUID('4')
  roomId: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['submitAt', 'score'])
  sortBy?: string = 'submitAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @Transform(({ value }) => value?.toUpperCase())
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  @IsIn(['all', 'graded', 'ungraded'])
  filter?: 'all' | 'graded' | 'ungraded' = 'all';
}
