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
import { AssignmentService } from './assignment.service';
import { CreateAssignmentDto } from './dto/create-assignment.dto';
import { UpdateAssignmentDto } from './dto/update-assignment.dto';
import { QueryAssignmentDto } from './dto/query-assignment.dto';
import { QueryInstructorAssignmentDto } from './dto/query-instructor-assignment.dto';
import { QueryStudentAssignmentDto } from './dto/query-student-assignment.dto';
import { SubmitAttemptDto } from './dto/submit-attempt.dto';
import { ScoreAttemptDto } from './dto/score-attempt.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';

import { RoomRoles } from '../auth/decorators/room-roles.decorator';
import { RoomMemberRole } from '../entities/room-member.entity';
import { RoomRoleGuard } from 'src/auth/guards/roles/room-role.guard';

@Controller('assignments')
@UseGuards(JwtAuthGuard)
export class AssignmentController {
  constructor(private readonly assignmentService: AssignmentService) {}

  @Post('/create')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  create(@Body() createAssignmentDto: CreateAssignmentDto, @Request() req) {
    return this.assignmentService.create(createAssignmentDto, req.user.id);
  }

  @Get()
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  findAll(@Query() queryDto: QueryAssignmentDto, @Request() req) {
    return this.assignmentService.findAll(queryDto, req.user.id);
  }

  @Get('instructor')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.ADMIN)
  findAllForInstructor(@Query() queryDto: QueryInstructorAssignmentDto, @Request() req) {
    return this.assignmentService.findAllForInstructor(queryDto, req.user.id);
  }

  @Get('student')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  findAllForStudent(@Query() queryDto: QueryStudentAssignmentDto, @Request() req) {
    return this.assignmentService.findAllForStudent(queryDto, req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.assignmentService.findOne(id, req.user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateAssignmentDto: UpdateAssignmentDto,
    @Request() req,
  ) {
    return this.assignmentService.update(id, updateAssignmentDto, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.assignmentService.remove(id, req.user.id);
  }

  @Post('attempts')
  @UseGuards(RoomRoleGuard)
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  submitAttempt(@Body() submitAttemptDto: SubmitAttemptDto, @Request() req) {
    return this.assignmentService.submitAttempt(submitAttemptDto, req.user.id);
  }

  @Get(':id/attempts')
  getAttempts(@Param('id') id: string, @Request() req) {
    return this.assignmentService.getAttempts(id, req.user.id);
  }

  @Get(':id/my-attempt')
  getMyAttempt(@Param('id') id: string, @Request() req) {
    return this.assignmentService.getMyAttempt(id, req.user.id);
  }

  @Patch('attempts/:attemptId/score')
  scoreAttempt(
    @Param('attemptId') attemptId: string,
    @Body() scoreAttemptDto: ScoreAttemptDto,
    @Request() req,
  ) {
    return this.assignmentService.scoreAttempt(attemptId, scoreAttemptDto.score, req.user.id);
  }
}
