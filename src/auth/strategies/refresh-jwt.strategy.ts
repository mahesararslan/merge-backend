import { ConfigType } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { AuthJwtPayload } from "../types/auth-jwtPayload";
import { Inject, Injectable } from "@nestjs/common";
import { AuthService } from "../auth.service";
import refreshJwtConfig from "../config/refresh-jwt.config";
import { Request } from "express";

@Injectable()
export class RefreshJwtStrategy extends PassportStrategy(Strategy, 'refresh-jwt') {
    constructor(
        @Inject(refreshJwtConfig.KEY)
        private refreshJwtConfiguration: ConfigType<typeof refreshJwtConfig>,
        private authService: AuthService
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            secretOrKey: refreshJwtConfiguration.secret!,
            ignoreExpiration: false,
            passReqToCallback: true,
        });

    }

    // the payload is already validated and then passed to this function. 
    async validate(req: Request, payload: AuthJwtPayload) {
        const refreshToken =  req.get("authorization")?.replace("Bearer", "").trim();
        const userId = payload.sub;
        return await this.authService.validateRefreshToken(userId, refreshToken!); 
    }
}