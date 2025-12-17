import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Patch, 
  Param, 
  Delete, 
  UseGuards, 
  Request, 
  Query 
} from '@nestjs/common';
import { QuizService } from './quiz.service';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { QueryQuizDto } from './dto/query-quiz.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RoomMemberRole } from '../entities/room-member.entity';
import { RoomRoleGuard } from 'src/auth/guards/roles/room-role.guard';
import { RoomRoles } from 'src/auth/decorators/room-roles.decorator';

@Controller('quizzes')
@UseGuards(JwtAuthGuard)
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Post()
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  create(@Body() createQuizDto: CreateQuizDto, @Request() req) {
    return this.quizService.create(createQuizDto, req.user.id);
  }

  @Get()
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  findAll(@Query() queryDto: QueryQuizDto, @Request() req) {
    return this.quizService.findAll(queryDto, req.user.id);
  }

  @Get(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  findOne(@Param('id') id: string, @Request() req) {
    return this.quizService.findOne(id, req.user.id);
  }

  @Patch(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body() updateQuizDto: UpdateQuizDto,
    @Request() req,
  ) {
    return this.quizService.update(id, updateQuizDto, req.user.id);
  }

  @Delete(':id')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  remove(@Param('id') id: string, @Request() req) {
    return this.quizService.remove(id, req.user.id);
  }

  @Post('attempts')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  submitAttempt(@Body() submitAttemptDto: SubmitAttemptDto, @Request() req) {
    return this.quizService.submitAttempt(submitAttemptDto, req.user.id);
  }

  @Get(':id/attempts')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  getAttempts(@Param('id') id: string, @Request() req) {
    return this.quizService.getAttempts(id, req.user.id);
  }

  @Get(':id/my-attempt')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  getMyAttempt(@Param('id') id: string, @Request() req) {
    return this.quizService.getMyAttempt(id, req.user.id);
  }
}
