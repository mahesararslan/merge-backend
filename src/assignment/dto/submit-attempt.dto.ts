import { IsString, IsUUID, IsArray, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class SubmitAttemptDto {
  @IsUUID('4')
  assignmentId: string;

  @IsUUID('4')
  roomId: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  fileKeys: string[];

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  fileUrls: string[];
}
