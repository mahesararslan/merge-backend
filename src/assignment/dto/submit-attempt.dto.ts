import { IsString, IsUUID } from 'class-validator';

export class SubmitAttemptDto {
  @IsUUID('4')
  assignmentId: string;

  @IsString()
  fileKey: string;

  @IsString()
  fileUrl: string;
}
