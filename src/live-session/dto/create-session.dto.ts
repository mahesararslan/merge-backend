import { IsString, IsOptional, IsUUID, IsDateString, MaxLength } from 'class-validator';

export class CreateSessionDto {
  @IsUUID('4')
  roomId: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
