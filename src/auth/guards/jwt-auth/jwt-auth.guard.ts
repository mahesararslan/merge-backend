import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from 'src/auth/decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  // doesnt apply jwt verification on handlers with @Public() decorator
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    // Handle token expiration
    if (info?.name === 'TokenExpiredError') {
      throw new UnauthorizedException('access token expired');
    }
    
    // Handle other JWT errors
    if (info?.name === 'JsonWebTokenError') {
      throw new UnauthorizedException('invalid access token');
    }

    // Handle missing token or other errors
    if (err || !user) {
      throw err || new UnauthorizedException('Unauthorized');
    }

    return user;
  }
}
