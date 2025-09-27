import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class LoginWithOTPDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  @MaxLength(6)
  otpCode: string;
}