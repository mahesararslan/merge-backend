import { IsBoolean } from 'class-validator';

export class Toggle2FADto {
  @IsBoolean()
  enable: boolean;
}