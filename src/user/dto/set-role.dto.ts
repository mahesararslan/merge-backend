import { IsEnum } from 'class-validator';
import { UserRole } from 'src/entities/user.entity';

export class SetRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}
