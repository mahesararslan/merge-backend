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
  async login(@Request() req, @Res({ passthrough: true }) res) {
    const result = await this.authService.signin(req.user.id, req.user.twoFactorEnabled, req.user.email);
    if ('token' in result && 'refreshToken' in result) {
      this.setAuthCookies(res, result.token, result.refreshToken);
    }
    return result;
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Get('verify')
  async verifyEmail(@Query('token') token: string, @Res({ passthrough: true }) res) {
    const result = await this.authService.verifyEmail(token);
    this.setAuthCookies(res, result.token, result.refreshToken);
    return result;
  }

  @Throttle({ default: { limit: 2, ttl: 10000 } }) // 2 req per 10 seconds
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('signin/otp')
  async loginWithOTP(@Body() loginWithOTPDto: LoginWithOTPDto, @Res({ passthrough: true }) res) {
    const result = await this.authService.loginWithOTP(loginWithOTPDto);
    this.setAuthCookies(res, result.token, result.refreshToken);
    return result;
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
  async refreshToken(@Req() req, @Res({ passthrough: true }) res) {
    const result = await this.authService.refreshToken(req.user.id);
    this.setAuthCookies(res, result.token, result.refreshToken);
    return result;
  }

  @Throttle({ default: { limit: 2, ttl: 10000 } }) //  2 req per 10 seconds
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() forgotPasswordDto: ForgotPasswordDto) {
    return this.authService.forgotPassword(forgotPasswordDto);
  }

  @Throttle({ default: { limit: 2, ttl: 10000 } }) // 2 req per 10 seconds
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
    this.setAuthCookies(res, response.token, response.refreshToken);
    res.redirect(`${process.env.FRONTEND_URL}/callback?token=${response.token}&refreshToken=${response.refreshToken}`);
  }

  @HttpCode(HttpStatus.OK)
  @Post('/logout')
  async SignOut(@Req() req, @Res({ passthrough: true }) res) {
    this.authService.signOut(req.user.id);
    this.clearAuthCookies(res);
    return {
      success: true,
      message: 'Successfully Signed Out'
    }
  }

  private setAuthCookies(res, accessToken: string, refreshToken: string) {
    const cookieOptions = {
      httpOnly: true,
      // secure: process.env.NODE_ENV === 'production',
      domain: '.onrender.com',
      secure: true,
      sameSite: 'none' as const,
    };

    res.cookie('accessToken', accessToken, {
      ...cookieOptions,
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('refreshToken', refreshToken, {
      ...cookieOptions,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  private clearAuthCookies(res) {
    res.clearCookie('accessToken');
    res.clearCookie('refreshToken');
  }
}
