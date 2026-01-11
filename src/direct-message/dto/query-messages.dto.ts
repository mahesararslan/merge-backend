import { IsOptional, IsUUID, IsIn } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryMessagesDto {
  @IsUUID('4')
  participantId: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 50;

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @Transform(({ value }) => value?.toUpperCase())
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  @IsUUID('4')
  beforeMessageId?: string;

  @IsOptional()
  @IsUUID('4')
  afterMessageId?: string;
}
