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
import { AnnouncementService } from './announcement.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { ScheduleAnnouncementDto } from './dto/schedule-announcement.dto';
import { QueryAnnouncementDto } from './dto/query-announcement.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RoomRoleGuard } from '../auth/guards/roles/room-role.guard';
import { RoomRoles } from '../auth/decorators/room-roles.decorator';
import { RoomMemberRole } from '../entities/room-member.entity';

@Controller('announcements')
@UseGuards(JwtAuthGuard)
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Post('create')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR, RoomMemberRole.ADMIN)
  create(@Body() createAnnouncementDto: CreateAnnouncementDto, @Request() req) {
    return this.announcementService.create(createAnnouncementDto, req.user.id);
  }

  @Post('schedule')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR, RoomMemberRole.ADMIN)
  schedule(@Body() scheduleAnnouncementDto: ScheduleAnnouncementDto, @Request() req) {
    return this.announcementService.schedule(scheduleAnnouncementDto, req.user.id);
  }

  @Get()
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR, RoomMemberRole.ADMIN)
  findAll(@Query() queryDto: QueryAnnouncementDto) {
    return this.announcementService.findAll(queryDto);
  }

  @Get(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR, RoomMemberRole.ADMIN)
  findOne(
    @Param('id') id: string,
    @Query('roomId') roomId: string,
  ) {
    return this.announcementService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR, RoomMemberRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body() updateAnnouncementDto: UpdateAnnouncementDto,
    @Request() req,
  ) {
    return this.announcementService.update(id, updateAnnouncementDto, req.user.id);
  }

  @Delete(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR, RoomMemberRole.ADMIN)
  remove(
    @Param('id') id: string,
    @Query('roomId') roomId: string,
    @Request() req,
  ) {
    return this.announcementService.remove(id, req.user.id);
  }
}
