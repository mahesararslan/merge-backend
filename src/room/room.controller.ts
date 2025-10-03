// src/room/room.controller.ts
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

@Controller('room')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  // Create a new room
  @Post('create')
  create(@Body() createRoomDto: CreateRoomDto, @Req() req) {
    return this.roomService.create(createRoomDto, req.user.id);
  }

  // Get all public rooms with pagination and search
  @Public()
  @Get()
  @UseInterceptors(CacheInterceptor)
  findAll(
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
    @Query('search') search?: string,
  ) {
    return this.roomService.findAll(page, limit, search);
  }

  // Search rooms by tags
  // @Get('search-by-tags')
  // @UseInterceptors(CacheInterceptor)
  // searchByTags(@Query('tags') tags: string) {
  //   const tagNames = tags ? tags.split(',').map(tag => tag.trim()) : [];
  //   return this.roomService.searchRoomsByTags(tagNames);
  // }

  // Join room by code
  @Post('join')
  joinRoom(@Body() joinRoomDto: JoinRoomDto, @Req() req) {
    return this.roomService.joinRoom(joinRoomDto.roomCode, req.user.id);
  }

  // // Get room by room code
  // @Get('code/:roomCode')
  // @UseInterceptors(CacheInterceptor)
  // findByRoomCode(@Param('roomCode') roomCode: string) {
  //   return this.roomService.findByRoomCode(roomCode);
  // }

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