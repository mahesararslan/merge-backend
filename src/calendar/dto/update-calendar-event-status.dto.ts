import { IsEnum, IsNotEmpty } from 'class-validator';
import { TaskStatus } from '../../entities/calendar-event.entity';

export class UpdateCalendarEventStatusDto {
  @IsEnum(TaskStatus)
  @IsNotEmpty()
  status: TaskStatus;
}
