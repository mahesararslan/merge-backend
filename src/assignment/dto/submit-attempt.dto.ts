import { IsString, IsUUID } from 'class-validator';

export class SubmitAttemptDto {
  @IsUUID('4')
  assignmentId: string;

  @IsUUID('4')
  roomId: string;

  @IsString()
  fileKey: string;

  @IsString()
  fileUrl: string;
}
