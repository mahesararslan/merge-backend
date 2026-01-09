import { ConfigType } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import jwtConfig from '../config/jwt.config';
import { AuthJwtPayload } from "../types/auth-jwtPayload";
import { Inject, Injectable } from "@nestjs/common";
import { AuthService } from "../auth.service";
import { Request } from "express";

// This strategy is used to validate JWT tokens
// It extracts the JWT from cookies and validates it using the secret key

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(
        @Inject(jwtConfig.KEY)
        private jwtConfiguration: ConfigType<typeof jwtConfig>,
        private authService: AuthService
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromExtractors([
                (request: Request) => {
                    return request?.cookies?.accessToken ?? null;
                },
            ]),
            secretOrKey: jwtConfiguration.secret!,
            ignoreExpiration: false,
        });

    }

    // the payload is already validated and then passed to this function. 
    async validate(payload: AuthJwtPayload) {
        const userId = payload.sub;
        return await this.authService.validateJwtUser(userId);
    }
}