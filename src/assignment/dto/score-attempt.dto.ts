import { IsNumber, Min, Max } from 'class-validator';

export class ScoreAttemptDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  score: number;
}
