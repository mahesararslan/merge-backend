import { IsString, IsOptional, IsBoolean, IsDateString, MaxLength, IsNumber, Min, IsArray, ArrayMaxSize } from 'class-validator';

export class UpdateAssignmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(3)
  assignmentUrls?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  totalScore?: number;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsBoolean()
  isTurnInLateEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}
