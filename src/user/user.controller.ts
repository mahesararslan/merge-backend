
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

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

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

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.userService.getProfileWithID(id);
  }


  // add route for getting all users of a specific room
  

}