import { IsString, IsOptional, IsUUID, IsBoolean, IsDateString, MaxLength, IsNumber, Min, IsArray, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FileItemDto } from './file-item.dto';

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

  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => FileItemDto)
  assignmentFiles: FileItemDto[];

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
