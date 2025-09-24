
import { IsEmail, IsString, IsOptional, IsEnum, MinLength } from 'class-validator';
import { UserRole } from 'src/entity/user.entity'; 

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}