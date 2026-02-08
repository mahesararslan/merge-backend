import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  UseGuards,
  Req,
  UseInterceptors,
  Query,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { StoreFcmTokenDto } from './dto/store-fcm-token.dto';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/entities/user.entity';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { Public } from 'src/auth/decorators/public.decorator';
import { TagService } from 'src/tag/tag.service';
import { UserTagsDto } from './dto/user-tags.dto';
import { QueryUserRoomsDto } from 'src/room/dto/query-user-rooms.dto';

@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly tagService: TagService,
  ) {}

  @Get('profile')
  getProfile(@Req() req) {
    return this.userService.findOne(req.user.id);
  }

  @Patch('/update')
  updateProfile(@Req() req, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(req.user.id, updateUserDto);
  }

  @Patch('/change-password')
  changePassword(@Req() req, @Body() updatePasswordDto: UpdatePasswordDto) {
    return this.userService.updatePassword(req.user.id, updatePasswordDto);
  }

  @Post('/fcm-token')
  storeFcmToken(@Req() req, @Body() storeFcmTokenDto: StoreFcmTokenDto) {
    return this.userService.storeFcmToken(req.user.id, storeFcmTokenDto);
  }

  @Get('rooms')
  getUserRooms(@Query() queryDto: QueryUserRoomsDto, @Req() req) {
    return this.userService.findUserRooms(req.user.id, queryDto);
  }

  @Get('/tags')
  getUserTags(@Req() req) {
    return this.userService.getUserTags(req.user.id);
  }

  @Patch('/tags')
  setUserTags(@Req() req, @Body() userTagsDto: UserTagsDto) {
    return this.userService.setUserTags(req.user.id, userTagsDto.tagNames);
  }

  @Public()
  @Get('/available-tags')
  getAvailableTags() {
    return this.tagService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.getProfileWithID(id);
  }
}
