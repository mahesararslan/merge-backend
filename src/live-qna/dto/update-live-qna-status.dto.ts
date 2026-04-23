import { IsEnum } from 'class-validator';
import { LiveQnaQuestionStatus } from '../../entities/live-qna-question.entity';

export class UpdateLiveQnaStatusDto {
  @IsEnum(LiveQnaQuestionStatus)
  status: LiveQnaQuestionStatus;
}
