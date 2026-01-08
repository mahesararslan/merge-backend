import { IsOptional, IsIn, IsUUID, IsNotEmpty } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryInstructorAssignmentDto {
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

  @IsNotEmpty()
  @IsUUID('4')
  roomId: string;

  @IsOptional()
  @IsIn(['all', 'needs_grading', 'graded', 'open', 'closed'])
  filter?: 'all' | 'needs_grading' | 'graded' | 'open' | 'closed' = 'all';
}
