import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Request,
  Logger,
} from '@nestjs/common';
import { LiveQnaService, LiveQnaQuestionResponse } from './live-qna.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { RoomRoleGuard } from '../auth/guards/roles/room-role.guard';
import { RoomRoles } from '../auth/decorators/room-roles.decorator';
import { RoomMemberRole } from '../entities/room-member.entity';
import { CreateLiveQnaQuestionDto } from './dto/create-live-qna-question.dto';
import { UpdateLiveQnaStatusDto } from './dto/update-live-qna-status.dto';
import { LiveQnaQuestionStatus } from '../entities/live-qna-question.entity';

@Controller('rooms')
@UseGuards(JwtAuthGuard, RoomRoleGuard)
export class LiveQnaController {
  private readonly logger = new Logger(LiveQnaController.name);

  constructor(private readonly liveQnaService: LiveQnaService) {}

  @Get(':roomId/live-sessions/:sessionId/live-qna/questions')
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR, RoomMemberRole.ADMIN)
  async listQuestions(
    @Param('roomId') roomId: string,
    @Param('sessionId') sessionId: string,
    @Request() req: any,
  ): Promise<{ questions: LiveQnaQuestionResponse[] }> {
    this.logger.log(
      `listQuestions roomId=${roomId} sessionId=${sessionId} userId=${req.user?.id}`,
    );
    const questions = await this.liveQnaService.listQuestions(
      roomId,
      sessionId,
      req.user.id,
    );
    return { questions };
  }

  @Post(':roomId/live-sessions/:sessionId/live-qna/questions')
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async createQuestion(
    @Param('roomId') roomId: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateLiveQnaQuestionDto,
    @Request() req: any,
  ): Promise<LiveQnaQuestionResponse> {
    this.logger.log(
      `createQuestion roomId=${roomId} sessionId=${sessionId} userId=${req.user?.id}`,
    );
    try {
      const question = await this.liveQnaService.createQuestion(
        roomId,
        sessionId,
        dto,
        req.user.id,
      );
      this.logger.log(`createQuestion success questionId=${question.id}`);
      return question;
    } catch (error) {
      this.logger.error(
        `createQuestion failed roomId=${roomId} sessionId=${sessionId} userId=${req.user?.id}`,
        (error as Error)?.stack,
      );
      throw error;
    }
  }

  @Post(':roomId/live-sessions/:sessionId/live-qna/questions/:questionId/votes')
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  async voteQuestion(
    @Param('roomId') roomId: string,
    @Param('sessionId') sessionId: string,
    @Param('questionId') questionId: string,
    @Request() req: any,
  ): Promise<LiveQnaQuestionResponse> {
    this.logger.log(
      `voteQuestion roomId=${roomId} sessionId=${sessionId} questionId=${questionId} userId=${req.user?.id}`,
    );
    return this.liveQnaService.voteQuestion(roomId, sessionId, questionId, req.user.id);
  }

  @Delete(':roomId/live-sessions/:sessionId/live-qna/questions/:questionId/votes')
  @RoomRoles(RoomMemberRole.MEMBER, RoomMemberRole.MODERATOR)
  async unvoteQuestion(
    @Param('roomId') roomId: string,
    @Param('sessionId') sessionId: string,
    @Param('questionId') questionId: string,
    @Request() req: any,
  ): Promise<LiveQnaQuestionResponse> {
    this.logger.log(
      `unvoteQuestion roomId=${roomId} sessionId=${sessionId} questionId=${questionId} userId=${req.user?.id}`,
    );
    return this.liveQnaService.unvoteQuestion(roomId, sessionId, questionId, req.user.id);
  }

  @Patch(':roomId/live-sessions/:sessionId/live-qna/questions/:questionId/status')
  @RoomRoles(RoomMemberRole.ADMIN)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async updateStatus(
    @Param('roomId') roomId: string,
    @Param('sessionId') sessionId: string,
    @Param('questionId') questionId: string,
    @Body() dto: UpdateLiveQnaStatusDto,
    @Request() req: any,
  ): Promise<LiveQnaQuestionResponse> {
    this.logger.log(
      `updateStatus roomId=${roomId} sessionId=${sessionId} questionId=${questionId} status=${dto.status} userId=${req.user?.id}`,
    );
    return this.liveQnaService.updateStatus(
      roomId,
      sessionId,
      questionId,
      dto.status,
      req.user.id,
    );
  }

  @Delete(':roomId/live-sessions/:sessionId/live-qna/questions/:questionId')
  @RoomRoles(RoomMemberRole.ADMIN)
  async deleteQuestion(
    @Param('roomId') roomId: string,
    @Param('sessionId') sessionId: string,
    @Param('questionId') questionId: string,
  ): Promise<{ id: string }> {
    this.logger.log(
      `deleteQuestion roomId=${roomId} sessionId=${sessionId} questionId=${questionId}`,
    );
    return this.liveQnaService.removeQuestion(roomId, sessionId, questionId);
  }
}
