import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { LiveSessionService } from './live-session.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { QuerySessionDto } from './dto/query-session.dto';
import { LeaveSessionDto } from './dto/leave-session.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RoomRoles } from '../auth/decorators/room-roles.decorator';
import { RoomMemberRole } from '../entities/room-member.entity';
import { RoomRoleGuard } from '../auth/guards/roles/room-role.guard';

@Controller('live-sessions')
@UseGuards(JwtAuthGuard)
export class LiveSessionController {
  constructor(private readonly liveSessionService: LiveSessionService) {}

  @Post('/create')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  create(@Body() createSessionDto: CreateSessionDto, @Request() req) {
    return this.liveSessionService.create(createSessionDto, req.user.id);
  }

  @Get()
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  findAll(@Query() queryDto: QuerySessionDto, @Request() req) {
    return this.liveSessionService.findAll(queryDto, req.user.id);
  }

  @Get(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  findOne(
    @Param('id') id: string,
    @Query('roomId') roomId: string,
    @Request() req,
  ) {
    return this.liveSessionService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body() updateSessionDto: UpdateSessionDto,
    @Request() req,
  ) {
    return this.liveSessionService.update(id, updateSessionDto, req.user.id);
  }

  @Delete(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  remove(
    @Param('id') id: string,
    @Query('roomId') roomId: string,
    @Request() req,
  ) {
    return this.liveSessionService.remove(id, req.user.id);
  }

  @Post(':id/start')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  start(
    @Param('id') id: string,
    @Query('roomId') roomId: string,
    @Request() req,
  ) {
    return this.liveSessionService.start(id, req.user.id);
  }

  @Post(':id/end')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  end(
    @Param('id') id: string,
    @Query('roomId') roomId: string,
    @Request() req,
  ) {
    return this.liveSessionService.end(id, req.user.id);
  }

  @Post(':id/leave')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  leave(
    @Param('id') id: string,
    @Query('roomId') roomId: string,
    @Body() leaveSessionDto: LeaveSessionDto,
    @Request() req,
  ) {
    return this.liveSessionService.leave(id, req.user.id, leaveSessionDto);
  }

  @Post(':id/join')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  join(
    @Param('id') id: string,
    @Query('roomId') roomId: string,
    @Request() req,
  ) {
    return this.liveSessionService.join(id, req.user.id);
  }

  @Get(':id/summary')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  getSummary(
    @Param('id') id: string,
    @Query('roomId') roomId: string,
    @Request() req,
  ) {
    return this.liveSessionService.getSummary(id, req.user.id);
  }
}
