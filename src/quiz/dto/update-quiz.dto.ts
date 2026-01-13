import { IsString, IsOptional, IsInt, Min, IsArray, ValidateNested, ArrayMinSize, IsBoolean, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { QuizQuestionDto } from './create-quiz.dto';

export class UpdateQuizDto {
  @IsUUID('4')
  roomId: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  timeLimitMin?: number;

  @IsOptional()
  deadline?: string | Date;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QuizQuestionDto)
  questions?: QuizQuestionDto[];

  @IsOptional()
  @IsBoolean()
  isClosed?: boolean;
}
