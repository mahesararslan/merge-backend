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
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RoomService } from './room.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { JoinRoomDto } from './dto/join-room.dto';
import { ReviewJoinRequestDto } from './dto/review-join-request.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';
import { Public } from '../auth/decorators/public.decorator';
import { QueryUserRoomsDto } from './dto/query-user-rooms.dto';
import { QueryAllRoomsDto } from './dto/query-all-rooms.dto';
import { QueryUserFeedDto } from './dto/query-user-feed.dto';
import { QueryRoomContentDto } from './dto/query-room-content.dto';
import { BulkDeleteContentDto } from './dto/bulk-delete-content.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RoomRoles } from '../auth/decorators/room-roles.decorator';
import { RoomMemberRole } from 'src/entities/room-member.entity';
import { RoomRoleGuard } from 'src/auth/guards/roles/room-role.guard';

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

  // Join room by code (public rooms: direct join, private rooms: creates join request)
  @Post('join')
  joinRoom(@Body() joinRoomDto: JoinRoomDto, @Req() req) {
    return this.roomService.joinRoom(joinRoomDto.roomCode, req.user.id);
  }

  // Get my pending join requests
  @Get('join-requests/my')
  getMyJoinRequests(@Req() req) {
    return this.roomService.getMyJoinRequests(req.user.id);
  }

  // Cancel my join request
  @Delete('join-requests/:requestId')
  cancelJoinRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Req() req,
  ) {
    return this.roomService.cancelJoinRequest(requestId, req.user.id);
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

  // Update member role (admin only)
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  @Patch(':roomId/members/:memberId/role')
  updateMemberRole(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() updateMemberRoleDto: UpdateMemberRoleDto,
    @Req() req,
  ) {
    return this.roomService.updateMemberRole(
      roomId,
      memberId,
      updateMemberRoleDto.role,
      req.user.id,
    );
  }

  // Remove member from room (admin only)
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  @Delete(':roomId/members/:memberId')
  removeMember(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Req() req,
  ) {
    return this.roomService.removeMember(roomId, memberId, req.user.id);
  }

  // Get pending join requests for a room (admin/moderator only)
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN, RoomMemberRole.MODERATOR)
  @Get(':roomId/join-requests')
  getJoinRequests(@Param('roomId', ParseUUIDPipe) roomId: string, @Req() req) {
    return this.roomService.getJoinRequests(roomId, req.user.id);
  }

  // Accept or reject a join request (admin/moderator only)
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN, RoomMemberRole.MODERATOR)
  @Post(':roomId/join-requests/review')
  reviewJoinRequest(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() reviewDto: ReviewJoinRequestDto,
    @Req() req,
  ) {
    return this.roomService.reviewJoinRequest(
      roomId,
      reviewDto.requestId,
      reviewDto.action,
      req.user.id,
    );
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

  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR)
  @Delete(':roomId/course-content/bulk')
  @HttpCode(HttpStatus.OK)
  bulkDeleteCourseContent(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() bulkDeleteDto: BulkDeleteContentDto,
    @Req() req,
  ) {
    return this.roomService.bulkDeleteCourseContent(roomId, bulkDeleteDto, req.user.id);
  }

}
