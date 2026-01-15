import { IsOptional, IsIn, IsUUID } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryAnnouncementDto {
  @IsUUID('4')
  roomId: string;

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['createdAt', 'scheduledAt', 'title'])
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  @Transform(({ value }) => value?.toUpperCase())
  sortOrder?: 'ASC' | 'DESC' = 'DESC';

  @IsOptional()
  @IsIn(['all', 'published', 'scheduled', 'draft'])
  filter?: 'all' | 'published' | 'scheduled' | 'draft' = 'all';
}
