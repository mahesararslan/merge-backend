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
import { DirectMessageService } from './direct-message.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';


@Controller('direct-messages')
@UseGuards(JwtAuthGuard)
export class DirectMessageController {
  constructor(private readonly directMessageService: DirectMessageService) {}

  @Post()
  create(@Body() createMessageDto: CreateMessageDto, @Request() req) {
    return this.directMessageService.create(createMessageDto, req.user.id);
  }

  @Get('conversations')
  getConversationList(
    @Request() req,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.directMessageService.getConversationList(req.user.id, page, limit);
  }

  @Get('conversation')
  findConversation(@Query() queryDto: QueryMessagesDto, @Request() req) {
    return this.directMessageService.findConversation(queryDto, req.user.id);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.directMessageService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateMessageDto: UpdateMessageDto,
    @Request() req,
  ) {
    return this.directMessageService.update(id, updateMessageDto, req.user.id);
  }

  @Delete(':id/for-me')
  deleteForMe(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.directMessageService.deleteForMe(id, req.user.id);
  }

  @Delete(':id/for-everyone')
  deleteForEveryone(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.directMessageService.deleteForEveryone(id, req.user.id);
  }
}
