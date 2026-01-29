
import { IsString, IsOptional, IsDateString, IsEnum } from 'class-validator';
import { TaskCategory } from '../../entities/calendar-event.entity';

export class UpdateCalendarEventDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  deadline?: string;

  @IsOptional()
  @IsEnum(TaskCategory)
  taskCategory?: TaskCategory;
}
