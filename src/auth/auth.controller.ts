import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
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
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forget-password.dto';
import { Toggle2FADto } from './dto/toggle2fa.dto';
import { SendOTPDto } from './dto/send-otp.dto';
import { LoginWithOTPDto } from './dto/otp-signin.dto';
import { Throttle } from '@nestjs/throttler';

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
  @Post('signin')
  async login(@Request() req) {
    return await this.authService.signin(req.user.id, req.user.twoFactorEnabled, req.user.email); 
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Get('verify')
  async verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Throttle({ default: { limit: 2, ttl: 10000 } }) // 2 req per 10 seconds
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('signin/otp')
  async loginWithOTP(@Body() loginWithOTPDto: LoginWithOTPDto) {
    return this.authService.loginWithOTP(loginWithOTPDto);
  }

  @Throttle({ default: { limit: 2, ttl: 10000 } })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('resend-otp')
  async resendOTP(@Body() sendOTPDto: SendOTPDto) {
    return this.authService.sendOTP(sendOTPDto);
  }

  @HttpCode(HttpStatus.OK)
  @Patch('2fa/toggle')
  async toggle2FA(@Req() req, @Body() toggle2FADto: Toggle2FADto) {
    return this.authService.toggle2FA(req.user.id, toggle2FADto);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RefreshAuthGuard)
  @Post('refresh')
  async refreshToken(@Req() req) { 
    return await this.authService.refreshToken(req.user.id); 
  }

  @Throttle({ default: { limit: 2, ttl: 10000 } })
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Throttle({ default: { limit: 2, ttl: 10000 } }) 
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('reset-password')
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    return this.authService.resetPassword(resetPasswordDto);
  }

  @Public()
  @UseGuards(GoogleAuthGuard)
  @Get("/google/login")
  async googleLogin() {}

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
