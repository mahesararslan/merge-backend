// src/note/note.controller.ts
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
import { NoteService } from './note.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { QueryNoteDto } from './dto/query-note.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth/jwt-auth.guard';


@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NoteController {
  constructor(private readonly noteService: NoteService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createNoteDto: CreateNoteDto, @Req() req) {
    return this.noteService.create(createNoteDto, req.user.id);
  }

  @Get()
  findAll(@Query() queryDto: QueryNoteDto, @Req() req) {
    return this.noteService.findAll(queryDto, req.user.id);
  }

  @Get('recent/created')
  getRecentlyCreated(@Query('limit') limit: number = 5, @Req() req) {
    return this.noteService.findRecentlyCreated(req.user.id, limit);
  }

  @Get('recent/updated')
  getRecentlyUpdated(@Query('limit') limit: number = 5, @Req() req) {
    return this.noteService.findRecentlyUpdated(req.user.id, limit);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.noteService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateNoteDto: UpdateNoteDto,
    @Req() req,
  ) {
    return this.noteService.update(id, updateNoteDto, req.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req) {
    return this.noteService.remove(id, req.user.id);
  }
}