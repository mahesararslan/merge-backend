// src/folder/folder.controller.ts
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
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { FolderService } from './folder.service';
import { CreateFolderDto } from './dto/create-folder.dto';
import { UpdateFolderDto } from './dto/update-folder.dto';
import { QueryFolderDto } from './dto/query-folder.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth/jwt-auth.guard';
import { RoomRoleGuard } from 'src/room/guards/room-role.guard';
import { RoomRoles } from 'src/room/decorators/room-roles.decorator';
import { RoomMemberRole } from 'src/entities/room-member.entity';


@Controller('folders')
@UseGuards(JwtAuthGuard)
export class FolderController {
  constructor(private readonly folderService: FolderService) {}

  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MODERATOR)
  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createFolderDto: CreateFolderDto, @Req() req) {
    return this.folderService.create(createFolderDto, req.user.id);
  }

  @Get()
  findAll(@Query() queryDto: QueryFolderDto, @Req() req) {
    return this.folderService.findAll(queryDto, req.user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.folderService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateFolderDto: UpdateFolderDto,
    @Req() req,
  ) {
    return this.folderService.update(id, updateFolderDto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.folderService.remove(id, req.user.id);
  }
}