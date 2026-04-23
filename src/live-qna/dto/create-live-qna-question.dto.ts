import { IsString, MaxLength } from 'class-validator';

export class CreateLiveQnaQuestionDto {
  @IsString()
  @MaxLength(500)
  content: string;
}
