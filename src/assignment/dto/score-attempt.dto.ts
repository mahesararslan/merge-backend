import { IsNumber, Min } from 'class-validator';

export class ScoreAttemptDto {
  @IsNumber()
  @Min(0)
  score: number;
}
