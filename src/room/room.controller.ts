import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  ParseUUIDPipe,
  UseInterceptors,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { RoomService } from './room.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { Public } from '../auth/decorators/public.decorator';
import { QueryUserRoomsDto } from './dto/query-user-rooms.dto';
import { QueryAllRoomsDto } from './dto/query-all-rooms.dto';
import { QueryUserFeedDto } from './dto/query-user-feed.dto';
import { QueryRoomContentDto } from './dto/query-room-content.dto';
import { RoomRoleGuard } from './guards/room-role.guard';
import { RoomRoles } from './decorators/room-roles.decorator';
import { RoomMemberRole } from 'src/entities/room-member.entity';

@Controller('room')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  // Create a new room
  @Post('create')
  create(@Body() createRoomDto: CreateRoomDto, @Req() req) {
    return this.roomService.create(createRoomDto, req.user.id);
  }

  // Get my rooms with filters
  @Get('my-rooms')
  // @UseInterceptors(CacheInterceptor)
  getMyRooms(@Query() queryDto: QueryUserRoomsDto, @Req() req) {
    return this.roomService.findUserRoomsWithFilter(queryDto, req.user.id);
  }

  // Get all public rooms with pagination and search
  @Public()
  @Get()
  // @UseInterceptors(CacheInterceptor)
  findAll(@Query() queryDto: QueryAllRoomsDto) {
    return this.roomService.findAll(queryDto);
  }

  // get rooms for user feed which are according to his interests(tags)
  @Get('feed')
  // @UseInterceptors(CacheInterceptor)
  getUserFeed(@Req() req, @Query() queryDto: QueryUserFeedDto) {
    return this.roomService.getUserFeed(req.user.id, queryDto);
  }

  // Join room by code
  @Post('join')
  joinRoom(@Body() joinRoomDto: JoinRoomDto, @Req() req) {
    return this.roomService.joinRoom(joinRoomDto.roomCode, req.user.id);
  }

  // Get specific room by ID
  @Get(':roomId')
  // @UseInterceptors(CacheInterceptor)
  findOne(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.roomService.findOne(roomId);
  }

  // Update room settings
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  @Patch(':roomId')
  update(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() updateRoomDto: UpdateRoomDto,
    @Req() req,
  ) {
    return this.roomService.update(roomId, updateRoomDto, req.user.id);
  }

  // Delete room
  @UseGuards(RoomRoleGuard) 
  @RoomRoles(RoomMemberRole.ADMIN)
  @Delete(':roomId')
  remove(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req) {
    return this.roomService.delete(roomId, req.user.id);
  }

  // Leave room
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  @Delete(':roomId/leave')
  leaveRoom(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req) {
    return this.roomService.leaveRoom(roomId, req.user.id);
  }

  // Get room members
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  @Get(':roomId/members')
  // @UseInterceptors(CacheInterceptor)
  getRoomMembers(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req) {
    return this.roomService.getRoomMembers(roomId, req.user.id);
  }

  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  @Get(':roomId/course-content')
  // @UseInterceptors(CacheInterceptor)
  getRoomContent(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query() queryDto: QueryRoomContentDto,
    @Req() req,
  ) {
    return this.roomService.getRoomContent(roomId, queryDto, req.user.id);
  }

}
