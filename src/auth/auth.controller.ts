import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthGuard } from '@nestjs/passport';
import { Public } from './decorators/public.decorator';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import { GoogleAuthGuard } from './guards/google-auth/google-auth.guard';
import { RefreshAuthGuard } from './guards/refresh-auth/refresh-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('signup')
  create(@Body() createUserDto: CreateUserDto) {
    return this.authService.signup(createUserDto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('local')) 
  @Post('login')
  async login(@Request() req) {
    return await this.authService.login(req.user.id); 
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RefreshAuthGuard)
  @Post('refresh')
  async refreshToken(@Req() req) { 
    return await this.authService.refreshToken(req.user.id); 
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get("/google/user/login")
  async googleUserLogin() {}

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get("/google/admin/login")
  async ggoogleAdminLogin() {}

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get("/google/callback")
  async googleCallback(@Req() req, @Res() res) {
    const response = await this.authService.login(req.user.id);
    res.redirect(`${process.env.FRONTEND_URL}?token=${response.token}&refreshToken=${response.refreshToken}`);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/logout')
  async SignOut(@Req() req) {
    this.authService.signOut(req.user.id);
    return {
      success: true,
      message: 'Successfully Signed Out'
    }
  }
}
