import { IsString, IsOptional, IsEnum, ValidateIf } from 'class-validator';
import { NotificationStatus } from 'src/entities/user.entity';

export class StoreFcmTokenDto {
  @IsEnum(NotificationStatus)
  notificationStatus: NotificationStatus;

  @ValidateIf(o => o.notificationStatus === NotificationStatus.ALLOWED)
  @IsString()
  token?: string;

  @IsOptional()
  @IsString()
  deviceType?: string;

  @IsOptional()
  @IsString()
  deviceId?: string;
}
