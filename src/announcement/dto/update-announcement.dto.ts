import { IsString, IsOptional, IsBoolean, IsUUID } from 'class-validator';

export class UpdateAnnouncementDto {
  @IsUUID('4')
  roomId: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}
