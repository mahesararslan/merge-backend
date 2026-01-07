import { IsString, IsUUID, IsArray, ArrayMinSize, ArrayMaxSize, IsOptional, MaxLength } from 'class-validator';

export class SubmitAttemptDto {
  @IsUUID('4')
  assignmentId: string;

  @IsUUID('4')
  roomId: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  fileUrls: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
