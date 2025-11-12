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
  ParseIntPipe,
  UseInterceptors,
} from '@nestjs/common';
import { AnnouncementService } from './announcement.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { CacheInterceptor, CacheTTL } from '@nestjs/cache-manager';

@Controller('room/:roomId/announcements')
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Post()
  create(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body() createAnnouncementDto: CreateAnnouncementDto,
    @Req() req,
  ) {
    return this.announcementService.create(
      createAnnouncementDto,
      roomId,
      req.user.id,
    );
  }

  @Get()
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300) // 5 minutes
  findAll(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page: number = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit: number = 10,
  ) {
    return this.announcementService.findAll(roomId, page, limit);
  }

  @Get(':id')
  @UseInterceptors(CacheInterceptor)
  @CacheTTL(300)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.announcementService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateAnnouncementDto: UpdateAnnouncementDto,
    @Req() req,
  ) {
    return this.announcementService.update(id, updateAnnouncementDto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.announcementService.remove(id, req.user.id);
  }
}