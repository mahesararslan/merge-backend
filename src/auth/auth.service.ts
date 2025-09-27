import {
  BadRequestException,
  ConflictException,
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
import { first } from 'rxjs';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ForgotPasswordDto } from './dto/forget-password.dto';

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
    if (!user.isVerified)
      throw new UnauthorizedException('Please verify your email to login');

    const isPasswordValid = await compare(password, user.password);
    if (!isPasswordValid) throw new UnauthorizedException('Invalid password');
    return { id: user.id };
  }

  async signup(createUserDto: CreateUserDto) {
    const user = await this.userService.create(createUserDto);

    // Send verification email if not a Google account
    if (!user.googleAccount) {
      await this.mailService.sendVerificationEmail(
        user.email,
        `${user.firstName} ${user.lastName}` || 'User',
        user.verificationToken,
      );
    }

    return user;
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

  async verifyEmail(token: string) {
    try {
      const user = await this.userService.verifyEmail(token);

      // Generate tokens for the verified user
      const tokens = await this.generateTokens(user.id);

      return {
        message: 'Email verified successfully',
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isVerified: user.isVerified,
        },
        ...tokens,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new BadRequestException('Failed to verify email');
    }
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
        message:
          'Password reset email sent successfully. Please check your email.',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        // For security, don't reveal if email exists or not
        return {
          message:
            'If an account with that email exists, a password reset link has been sent.',
        };
      }
      throw new BadRequestException('Failed to process password reset request');
    }
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    try {
      const user = await this.userService.resetPassword(
        resetPasswordDto.token,
        resetPasswordDto.newPassword,
      );

      return {
        message:
          'Password reset successfully. You can now log in with your new password.',
        email: user.email,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new BadRequestException('Failed to reset password');
    }
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
      // If user does not exist, create a new user
      return this.userService.create(googleUser, true); // true indicates it's a Google account
    }
    // If user exists, return the user
    return user;
  }

  async signOut(userId: string) {
    await this.userService.updateHashedRefreshToken(userId, null);
  }
}
