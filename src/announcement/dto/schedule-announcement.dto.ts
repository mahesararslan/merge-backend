import { IsString, IsDateString, IsUUID } from 'class-validator';

export class ScheduleAnnouncementDto {
  @IsUUID('4')
  roomId: string;

  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsDateString()
  scheduledAt: string;
}
