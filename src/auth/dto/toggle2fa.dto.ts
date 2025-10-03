import { IsBoolean, IsString, MinLength } from 'class-validator';

export class Toggle2FADto {
  @IsBoolean()
  enable: boolean;

  @IsString()
  @MinLength(6)
  password: string;
}
