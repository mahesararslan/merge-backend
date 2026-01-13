import { IsArray, IsNumber, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AttemptScoreDto {
  @IsString()
  attemptId: string;

  @IsNumber()
  @Min(0)
  score: number;
}

export class BulkScoreAttemptsDto {
  @IsString()
  roomId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttemptScoreDto)
  attempts: AttemptScoreDto[];
}
