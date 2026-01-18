import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  Request,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { Type } from 'class-transformer';
import { IsOptional } from 'class-validator';

class GetNotificationsDto {
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  getUserNotifications(@Query() query: GetNotificationsDto, @Request() req) {
    return this.notificationService.getUserNotifications(
      req.user.id,
      query.page,
      query.limit,
    );
  }

  @Patch(':id/read')
  markAsRead(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.notificationService.markAsRead(id, req.user.id);
  }

  @Patch('read-all')
  markAllAsRead(@Request() req) {
    return this.notificationService.markAllAsRead(req.user.id);
  }

  @Delete(':id')
  deleteNotification(@Param('id', ParseUUIDPipe) id: string, @Request() req) {
    return this.notificationService.deleteNotification(id, req.user.id);
  }
}
