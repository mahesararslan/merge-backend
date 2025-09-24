import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { compare } from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { AuthJwtPayload } from './types/auth-jwtPayload';
import { CurrentUser } from './types/current-user';
import { CreateUserDto } from 'src/user/dto/create-user.dto';

@Injectable()
export class AuthService {

    constructor(private userService: UserService, private jwtService: JwtService) {}

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
        const payload: AuthJwtPayload = { sub: userId };
        const token = this.jwtService.sign(payload);
        return {
            userId,
            token,
        }
    }

    async validateJwtUser(userId: string) { 
        const user = await this.userService.findOne(userId);
        if (!user) throw new UnauthorizedException('User not found');
        const currentUser: CurrentUser = { id: user.id, role: user.role };
        return currentUser;
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

}
