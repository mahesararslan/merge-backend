import { IsString, IsOptional, IsBoolean, IsDateString, IsUUID } from 'class-validator';

export class CreateAnnouncementDto {
  @IsUUID('4')
  roomId: string;

  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
