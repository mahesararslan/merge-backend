import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { CanvasPermissionService } from './canvas-permission.service';
import { CanvasGateway } from './canvas.gateway';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [CanvasPermissionService, CanvasGateway],
  exports: [CanvasPermissionService],
})
export class CanvasModule {}
