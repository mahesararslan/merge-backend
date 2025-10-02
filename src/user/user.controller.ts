
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
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth/jwt-auth.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { UserRole } from 'src/entities/user.entity';
import { RolesGuard } from 'src/auth/guards/roles/roles.guard';
import { UpdatePasswordDto } from './dto/update-password.dto';
import { CacheInterceptor } from '@nestjs/cache-manager';
import { Public } from 'src/auth/decorators/public.decorator';
import { TagService } from 'src/tag/tag.service';
import { UserTagsDto } from './dto/user-tags.dto';

@Controller('user')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly tagService: TagService,
  ) {}

  @UseInterceptors(CacheInterceptor)
  @Get('profile')
  getProfile(@Req() req) {
    console.log("Fetching Profile");
    // return this.userService.testCache();
    return this.userService.findOne(req.user.id);
  }

  @Patch('/update')
  updateProfile(
    @Req() req,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.update(req.user.id, updateUserDto);
  }

  @Patch('/change-password')
  changePassword(
    @Req() req,
    @Body() updatePasswordDto: UpdatePasswordDto,
  ) {
    return this.userService.updatePassword(req.user.id, updatePasswordDto);
  }

  @Get('/tags')
  @UseInterceptors(CacheInterceptor)
  getUserTags(@Req() req) {
    return this.userService.getUserTags(req.user.id);
  }

  @Patch('/tags')
  setUserTags(
    @Req() req,
    @Body() userTagsDto: UserTagsDto,
  ) {
    return this.userService.setUserTags(req.user.id, userTagsDto.tagNames);
  }

  @Public()
  @Get('/available-tags')
  @UseInterceptors(CacheInterceptor)
  getAvailableTags() {
    return this.tagService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.getProfileWithID(id);
  }
  
  // add route for getting all users of a specific room
  // @Get('/room/:roomId/users')
  // getUsersByRoom(@Param('roomId') roomId: string) {
  //   return this.userService.findUsersByRoom(roomId);
  // }

}