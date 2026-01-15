import { IsString, IsOptional } from 'class-validator';

export class StoreFcmTokenDto {
  @IsString()
  token: string;

  @IsOptional()
  @IsString()
  deviceType?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}
