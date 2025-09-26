
import { IsEmail, IsString, IsOptional, IsEnum, MinLength, IsBoolean } from 'class-validator';
import { UserRole } from 'src/entities/user.entity'; 

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

}