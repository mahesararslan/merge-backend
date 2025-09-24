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

@Public() // this makes all the auth routes public, meaning they can be accessed without authentication
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @HttpCode(HttpStatus.OK)
  @Post('signup')
  create(@Body() createUserDto: CreateUserDto) {
    return this.authService.signup(createUserDto);
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('local')) 
  @Post('login')
  async login(@Request() req) {
    return await this.authService.login(req.user.id);
    
  }

  @UseGuards(GoogleAuthGuard)
  @Get("/google/login")
  async googleLogin() {}

  @UseGuards(GoogleAuthGuard)
  @Get("/google/callback")
  async googleCallback(@Req() req, @Res() res) {
    const response = await this.authService.login(req.user.id);
    res.redirect(`http://localhost:5173?token=${response.token}&userId=${response.userId}`);
  }
}
