import { IsString, IsUUID, IsArray, ArrayMinSize, ArrayMaxSize, IsOptional, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { FileItemDto } from './file-item.dto';

export class SubmitAttemptDto {
  @IsUUID('4')
  assignmentId: string;

  @IsUUID('4')
  roomId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => FileItemDto)
  files: FileItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
