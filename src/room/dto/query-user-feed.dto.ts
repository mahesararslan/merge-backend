import { IsOptional, IsBooleanString } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryUserFeedDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 10;

  @IsOptional()
  @IsBooleanString({ message: 'includeJoined must be a boolean string (true/false)' })
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return false; // default to false
  })
  includeJoined?: boolean = false;
}