import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  ParseUUIDPipe,
  Request,
} from '@nestjs/common';
import { GeneralChatService } from './general-chat.service';
import { CreateGeneralChatMessageDto } from './dto/create-general-chat-message.dto';
import { UpdateGeneralChatMessageDto } from './dto/update-general-chat-message.dto';
import { QueryGeneralChatMessagesDto } from './dto/query-general-chat-messages.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RoomRoleGuard } from '../auth/guards/roles/room-role.guard';
import { RoomRoles } from '../auth/decorators/room-roles.decorator';
import { RoomMemberRole } from '../entities/room-member.entity';

@Controller('general-chat')
@UseGuards(JwtAuthGuard)
export class GeneralChatController {
  constructor(private readonly generalChatService: GeneralChatService) {}

  @Post()
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  create(@Body() createMessageDto: CreateGeneralChatMessageDto, @Request() req) {
    return this.generalChatService.create(createMessageDto, req.user.id);
  }

  @Get()
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  findAll(@Query() queryDto: QueryGeneralChatMessagesDto, @Request() req) {
    return this.generalChatService.findAll(queryDto, req.user.id);
  }

  @Get(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('roomId', ParseUUIDPipe) roomId: string,
    @Request() req,
  ) {
    return this.generalChatService.findOne(id, roomId, req.user.id);
  }

  @Patch(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('roomId', ParseUUIDPipe) roomId: string,
    @Body() updateMessageDto: UpdateGeneralChatMessageDto,
    @Request() req,
  ) {
    return this.generalChatService.update(id, roomId, updateMessageDto, req.user.id);
  }

  @Delete(':id/for-me')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  deleteForMe(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('roomId', ParseUUIDPipe) roomId: string,
    @Request() req,
  ) {
    return this.generalChatService.deleteForMe(id, roomId, req.user.id);
  }

  @Delete(':id/for-everyone')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  deleteForEveryone(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('roomId', ParseUUIDPipe) roomId: string,
    @Request() req,
  ) {
    return this.generalChatService.deleteForEveryone(id, roomId, req.user.id);
  }
}
