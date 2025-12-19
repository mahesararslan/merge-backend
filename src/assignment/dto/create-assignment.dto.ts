import { IsString, IsOptional, IsUUID, IsBoolean, IsDateString, MaxLength, IsNumber, Min } from 'class-validator';

export class CreateAssignmentDto {
  @IsUUID('4')
  roomId: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsString()
  assignmentUrl: string;

  @IsNumber()
  @Min(0)
  totalScore: number;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsBoolean()
  isTurnInLateEnabled?: boolean;
}
