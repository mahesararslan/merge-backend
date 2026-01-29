import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  Request,
} from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { TaskStatus } from '../entities/calendar-event.entity';
import { UpdateCalendarEventStatusDto } from './dto/update-calendar-event-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';

@Controller('calendar')
@UseGuards(JwtAuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  @Post()
  async create(@Body() createCalendarEventDto: CreateCalendarEventDto, @Req() req) {
    return this.calendarService.create(createCalendarEventDto, req.user.id);
  }

  @Get()
  async findAll(@Request() req) {
    return this.calendarService.findAll(req.user.id);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Request() req) {
    return this.calendarService.findOne(id, req.user.id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateCalendarEventDto: UpdateCalendarEventDto,
    @Req() req,
  ) {
    return this.calendarService.update(id, updateCalendarEventDto, req.user.id);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateCalendarEventStatusDto,
    @Req() req,
  ) {
    return this.calendarService.updateStatus(id, updateStatusDto, req.user.id);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Request() req) {
    return this.calendarService.remove(id, req.user.id);
  }
}
