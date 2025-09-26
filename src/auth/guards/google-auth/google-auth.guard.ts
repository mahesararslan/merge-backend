import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from 'src/entities/user.entity';

@Injectable()
export class GoogleAuthGuard extends AuthGuard("google") {
  getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const options: any = {
      prompt: 'select_account'
    };
    
    // Determine role based on the endpoint
    let role = UserRole.USER;
    if (request.url.includes('/admin/')) {
      role = UserRole.ADMIN;
    }
    
    // Pass role via state parameter
    options.state = JSON.stringify({ role });
    
    return options;
  }
}