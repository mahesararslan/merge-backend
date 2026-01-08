import { IsOptional, IsIn, IsUUID, IsNotEmpty } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryStudentAssignmentDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['title', 'createdAt', 'startAt', 'endAt', 'totalScore'])
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
  @IsIn(['all', 'pending', 'missed', 'completed'])
  filter?: 'all' | 'pending' | 'missed' | 'completed' = 'all';
}
