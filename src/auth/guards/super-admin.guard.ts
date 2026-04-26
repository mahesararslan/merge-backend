import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Guards endpoints that should only be accessible to platform-wide
 * administrators. The admin allowlist is read from the SUPER_ADMIN_EMAILS
 * env var (comma-separated list of emails).
 *
 * Pair with @UseGuards(JwtAuthGuard, SuperAdminGuard).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (!user?.email) {
      throw new ForbiddenException('Super admin access required');
    }

    const raw = this.configService.get<string>('SUPER_ADMIN_EMAILS') || '';
    const allowed = raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (!allowed.includes(user.email.toLowerCase())) {
      throw new ForbiddenException('Super admin access required');
    }
    return true;
  }
}
