import { Inject, Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, VerifyCallback } from "passport-google-oauth20";
import googleOauthConfig from "../config/google-oauth.config";
import { ConfigType } from "@nestjs/config";
import { AuthService } from "../auth.service";
import { Role } from "../enums/role.enums";
import { UserRole } from "src/entities/user.entity";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy) { // auto registers this strategy as 'google' strategy
  constructor(
    private authService: AuthService,
    @Inject(googleOauthConfig.KEY)
    private googleConfiguration: ConfigType<typeof googleOauthConfig>
  ) {
    super({
      clientID: googleConfiguration.clientId ?? "",
      clientSecret: googleConfiguration.clientSecret ?? "",
      callbackURL: googleConfiguration.googleCallbackUrl ?? "",
      scope: ["email", "profile"],
    });                                                                                                
  }

  async validate(
    accessToken: string, // donot sent these to the client as they are access and refresh tokens from the google api
    refreshToken: string, // you should always send your own access and refresh tokens using JWT
    profile: any,
    done: VerifyCallback
  ) {
    console.log({ profile });
    const user = await this.authService.validateGoogleUser({
        email: profile.emails[0].value,
        firstName: profile.name.givenName,
        lastName: profile.name.familyName,
        image: profile.photos[0].value,
        password: "", // Password is not used for Google OAuth users
        role: UserRole.USER // Default role, can be adjusted as needed
    });
    done(null, user); // never pass profile obj in this as the Id this object is from the google api and not from your database
  }
  
}