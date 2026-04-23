import { IsOptional, IsUUID, IsEnum, IsNumberString } from 'class-validator';
import { SessionStatus } from '../../entities/live-video-session.entity';

export class QuerySessionDto {
  @IsUUID('4')
  roomId: string;

  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  sortBy?: string;

  @IsOptional()
  sortOrder?: 'ASC' | 'DESC';
}
