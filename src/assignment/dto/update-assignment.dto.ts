import { IsString, IsOptional, IsBoolean, IsDateString, MaxLength, IsNumber, Min, IsArray, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FileItemDto } from './file-item.dto';

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
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => FileItemDto)
  assignmentFiles?: FileItemDto[];

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
