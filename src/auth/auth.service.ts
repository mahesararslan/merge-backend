import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { compare } from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { AuthJwtPayload } from './types/auth-jwtPayload';
import { CurrentUser } from './types/current-user';
import { CreateUserDto } from 'src/user/dto/create-user.dto';
import refreshJwtConfig from './config/refresh-jwt.config';
import { ConfigType } from '@nestjs/config';
import * as argon2 from 'argon2';

@Injectable()
export class AuthService {

    constructor(
        private userService: UserService, 
        private jwtService: JwtService,
        @Inject(refreshJwtConfig.KEY) private refreshTokenConfig: ConfigType<typeof refreshJwtConfig>
    ) {}

    async validateUser(email: string, password: string): Promise<any> {
        const user = await this.userService.findByEmail(email);
        if (!user) throw new UnauthorizedException('User not found');

        const isPasswordValid = await compare(password, user.password);
        if (!isPasswordValid) throw new UnauthorizedException('Invalid password');
        return { id: user.id };
    }

    async signup(createUserDto: CreateUserDto) {
        return this.userService.create(createUserDto);
    }

    async login(userId: string) {
        const {accessToken, refreshToken} = await this.generateTokens(userId)
        const hashedRefreshToken = await argon2.hash(refreshToken);
        await this.userService.updateHashedRefreshToken(userId, hashedRefreshToken);
        return {
            userId,
            token: accessToken,
            refreshToken
        }
    }

    async generateTokens(userId: string) {
        const payload: AuthJwtPayload = { sub: userId }
        const [accessToken, refreshToken] = await Promise.all([
            this.jwtService.signAsync(payload),
            this.jwtService.signAsync(payload, this.refreshTokenConfig)
        ])

        return {
            accessToken,
            refreshToken
        }
    }   

    async validateJwtUser(userId: string) { 
        const user = await this.userService.findOne(userId);
        if (!user) throw new UnauthorizedException('User not found');
        const currentUser: CurrentUser = { id: user.id, role: user.role };
        return currentUser;
    }

    // refresh token rotation, everytime user refreshes access token, a new refresh token is also generated.
    async refreshToken(userId: string) {
        const {accessToken, refreshToken} = await this.generateTokens(userId)
        const hashedRefreshToken = await argon2.hash(refreshToken);
        await this.userService.updateHashedRefreshToken(userId, hashedRefreshToken);
        return {
            userId,
            token: accessToken,
            refreshToken
        }
    }

    async validateRefreshToken(userId: string, refreshToken: string) {
        const user = await this.userService.findOne(userId);
        if (!user || !user.hashedRefreshToken) throw new UnauthorizedException('Access Denied');
        const isRefreshTokenValid = await argon2.verify(user.hashedRefreshToken, refreshToken);
        if (!isRefreshTokenValid) throw new UnauthorizedException('Access Denied');
        return { id: user.id };
    }

    async validateGoogleUser(googleUser: CreateUserDto) {
        const user = await this.userService.findByEmail(googleUser.email);
        if (!user) {
            // If user does not exist, create a new user
            return this.userService.create(googleUser);
        }
        // If user exists, return the user
        return user;
    }

    async signOut(userId: string){
        await this.userService.updateHashedRefreshToken(userId, null)
    }

}
