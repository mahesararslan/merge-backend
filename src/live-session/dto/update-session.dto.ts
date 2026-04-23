import { IsString, IsOptional, IsDateString, MaxLength, IsUUID } from 'class-validator';

export class UpdateSessionDto {
  @IsUUID('4')
  roomId: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}
