import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { compare } from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { AuthJwtPayload } from './types/auth-jwtPayload';
import { CurrentUser } from './types/current-user';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import refreshJwtConfig from './config/refresh-jwt.config';
import { ConfigType } from '@nestjs/config';
import * as argon2 from 'argon2';
import { MailService } from 'src/mail/mail.service';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forget-password.dto';
import { SendOTPDto } from './dto/send-otp.dto';
import { Toggle2FADto } from './dto/toggle2fa.dto';
import { LoginWithOTPDto } from './dto/otp-signin.dto';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private mailService: MailService,
    @Inject(refreshJwtConfig.KEY)
    private refreshTokenConfig: ConfigType<typeof refreshJwtConfig>,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.userService.findByEmail(email);
    if (!user) throw new UnauthorizedException('User not found');
    if (!user.isVerified) {
      await this.mailService.sendVerificationEmail(
        user.email,
        `${user.firstName} ${user.lastName}` || 'User',
        user.verificationToken,
      );
      throw new UnauthorizedException('Please verify your email to login, A link has been sent to your email');
    }

    const isPasswordValid = await compare(password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('Invalid password');
    return { id: user.id, email: user.email, twoFactorEnabled: user.twoFactorEnabled };
  }

  async signup(createUserDto: CreateUserDto) {
    // cinvert email to lowercase
    createUserDto.email = createUserDto.email.toLowerCase();
    const user = await this.userService.create(createUserDto);

    // Send verification email if not a Google account
    if (!user.googleAccount) {
      console.log("Reached here to send email");
      await this.mailService.sendVerificationEmail(
        user.email,
        `${user.firstName} ${user.lastName}` || 'User',
        user.verificationToken,
      );
    }

    return {
      success: true,
      message: 'User registered successfully. Please check your email to verify your account.',
    };
  }

  async signin(userId: string, twoFactorEnabled: boolean, email: string) {
    if (twoFactorEnabled) { 
        return this.sendOTP({ email });
    }
    return this.login(userId);
  }

  async login(userId: string) {

    const { accessToken, refreshToken } = await this.generateTokens(userId);
    const hashedRefreshToken = await argon2.hash(refreshToken);
    await this.userService.updateHashedRefreshToken(userId, hashedRefreshToken);
    return {
      userId,
      token: accessToken,
      refreshToken,
    };
  }

  async loginWithOTP(loginWithOTPDto: LoginWithOTPDto) {
    const { email, otpCode } = loginWithOTPDto;
    const user = await this.userService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.twoFactorEnabled) {
      throw new BadRequestException('2FA is not enabled for this account');
    }

    // Verify OTP
    const otpUser = await this.userService.verifyOTP(email, otpCode);
    if (!otpUser) {
      throw new UnauthorizedException('Invalid or expired OTP code');
    }

    await this.userService.clearOTP(user.id);
    return this.login(user.id);
  }

  async verifyEmail(token: string) {
      const user = await this.userService.verifyEmail(token);

      // Generate tokens for the verified user
      const { accessToken, refreshToken } = await this.generateTokens(user.id);
      const hashedRefreshToken = await argon2.hash(refreshToken);
      await this.userService.updateHashedRefreshToken(user.id, hashedRefreshToken);

      return {
        message: 'Email verified successfully',
        userId: user.id,
        token: accessToken,
        refreshToken: refreshToken,
      };
  }

  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    try {
      const user = await this.userService.setPasswordResetToken(
        forgotPasswordDto.email,
      );

      await this.mailService.sendPasswordResetEmail(
        user.email,
        `${user.firstName} ${user.lastName}` || 'User',
        user.passwordResetToken,
      );

      return {
        success: true,
        message: 'Password reset email sent successfully. Please check your email.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        return { message: 'Could not process request.' };
      }
      throw new BadRequestException('Failed to process password reset request');
    }
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
      await this.userService.resetPassword(
        resetPasswordDto.token,
        resetPasswordDto.newPassword,
      );

      return {
        success: true,
        message: 'Password reset successfully. You can now log in with your new password.',
      };
  }

  async generateTokens(userId: string) {
    const payload: AuthJwtPayload = { sub: userId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync(payload, this.refreshTokenConfig),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  async validateJwtUser(userId: string) {
    const user = await this.userService.findOne(userId);
    if (!user) throw new UnauthorizedException('User not found');
    const currentUser: CurrentUser = { id: user.id, role: user.role };
    return currentUser;
  }

  // refresh token rotation, everytime user refreshes access token, a new refresh token is also generated.
  async refreshToken(userId: string) {
    const { accessToken, refreshToken } = await this.generateTokens(userId);
    const hashedRefreshToken = await argon2.hash(refreshToken);
    await this.userService.updateHashedRefreshToken(userId, hashedRefreshToken);
    return {
      userId,
      token: accessToken,
      refreshToken,
    };
  }

  async validateRefreshToken(userId: string, refreshToken: string) {
    const user = await this.userService.findOne(userId);
    if (!user || !user.hashedRefreshToken)
      throw new UnauthorizedException('Access Denied');
    const isRefreshTokenValid = await argon2.verify(
      user.hashedRefreshToken,
      refreshToken,
    );
    if (!isRefreshTokenValid) throw new UnauthorizedException('Access Denied');
    return { id: user.id };
  }

  async validateGoogleUser(googleUser: CreateUserDto) {
    const user = await this.userService.findByEmail(googleUser.email);
    if (!user) {
      return this.userService.create(googleUser, true); // true indicates it's a Google account
    }
    return user;
  }

  async sendOTP(sendOTPDto: SendOTPDto) {
    const { email } = sendOTPDto;

    const user = await this.userService.findByEmail(email);
    if (!user) {
        throw new NotFoundException('User with this email does not exist');
    }

    if (!user.twoFactorEnabled) {
        throw new BadRequestException('2FA is not enabled for this account');
    }

    // Generate and send new OTP
    const otpCode = await this.userService.setOTPCode(user.id);

    if (!otpCode) {
      throw new BadRequestException('Could not generate OTP code. Please try again.');
    }

    await this.mailService.sendOTPEmail(
      user.email,
      user.firstName || user.lastName || 'User',
      otpCode,
    );

    return {
      success: true,
      message: 'A new OTP has been sent to your email.',
    };
  }

  async toggle2FA(userId: string, toggle2FADto: Toggle2FADto) {
    const { enable, password } = toggle2FADto;

    const user = await this.userService.toggle2FA(userId, enable, password);

    return {
      success: true,
      message: enable
        ? '2FA has been enabled for your account'
        : '2FA has been disabled for your account',
      twoFactorEnabled: user.twoFactorEnabled,
    };
  }

  async signOut(userId: string) {
    await this.userService.updateHashedRefreshToken(userId, null);
  }
}
