import { IsEmail } from 'class-validator';

export class SendOTPDto {
  @IsEmail()
  email: string;
}