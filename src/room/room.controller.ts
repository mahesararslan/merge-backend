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
  @UseInterceptors(CacheInterceptor)
  getMyRooms(@Query() queryDto: QueryUserRoomsDto, @Req() req) {
    return this.roomService.findUserRoomsWithFilter(queryDto, req.user.id);
  }

  // Get all public rooms with pagination and search
  @Public()
  @Get()
  @UseInterceptors(CacheInterceptor)
  findAll(@Query() queryDto: QueryAllRoomsDto) {
    return this.roomService.findAll(queryDto);
  }

  // get rooms for user feed which are according to his interests(tags)
  @Get('feed')
  @UseInterceptors(CacheInterceptor)
  getUserFeed(@Req() req, @Query() queryDto: QueryUserFeedDto) {
    return this.roomService.getUserFeed(req.user.id, queryDto);
  }

  // Join room by code
  @Post('join')
  joinRoom(@Body() joinRoomDto: JoinRoomDto, @Req() req) {
    return this.roomService.joinRoom(joinRoomDto.roomCode, req.user.id);
  }

  // Get specific room by ID
  @Get(':id')
  @UseInterceptors(CacheInterceptor)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.roomService.findOne(id);
  }

  // Update room settings
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateRoomDto: UpdateRoomDto,
    @Req() req,
  ) {
    return this.roomService.update(id, updateRoomDto, req.user.id);
  }

  // Delete room
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.roomService.delete(id, req.user.id);
  }

  // Leave room
  @Delete(':id/leave')
  leaveRoom(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.roomService.leaveRoom(id, req.user.id);
  }

  // Get room members
  @Get(':id/members')
  @UseInterceptors(CacheInterceptor)
  getRoomMembers(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.roomService.getRoomMembers(id, req.user.id);
  }

  
}