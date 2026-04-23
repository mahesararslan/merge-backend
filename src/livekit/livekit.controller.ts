import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { LiveKitService } from './livekit.service';
import { GenerateTokenDto } from './dto/generate-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RoomRoles } from '../auth/decorators/room-roles.decorator';
import { RoomMemberRole } from '../entities/room-member.entity';
import { RoomRoleGuard } from '../auth/guards/roles/room-role.guard';

@Controller('livekit')
@UseGuards(JwtAuthGuard)
export class LiveKitController {
  constructor(private readonly livekitService: LiveKitService) {}

  @Post('token')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  generateToken(@Body() generateTokenDto: GenerateTokenDto, @Request() req) {
    return this.livekitService.generateToken(
      generateTokenDto.sessionId,
      req.user.id,
      generateTokenDto.roomId,
    );
  }
}
