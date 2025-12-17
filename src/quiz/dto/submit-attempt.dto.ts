import { IsUUID, IsNotEmpty, IsObject } from 'class-validator';

export class SubmitAttemptDto {
  @IsUUID('4')
  quizId: string;

  @IsUUID('4')
  roomId: string;

  @IsObject()
  @IsNotEmpty()
  answers: Record<string, string>; // { questionId: selectedOption }
}
