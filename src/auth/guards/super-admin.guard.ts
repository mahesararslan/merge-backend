import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../entities/user.entity';

/**
 * Guard for endpoints that should only be accessible to platform-wide
 * administrators (UserRole.SUPER_ADMIN). Pair with @UseGuards(JwtAuthGuard, SuperAdminGuard).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user || user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
