import { IsOptional, IsIn, IsUUID, IsNotEmpty } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryQuizAttemptsDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['submittedAt', 'score'])
  sortBy?: string = 'submittedAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @Transform(({ value }) => value?.toUpperCase())
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @IsNotEmpty()
  @IsUUID('4')
  roomId: string;
  
}
