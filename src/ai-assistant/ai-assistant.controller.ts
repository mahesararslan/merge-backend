import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AiAssistantService } from './ai-assistant.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { QueryAiDto } from './dto/query-ai.dto';
import { GetChatHistoryDto } from './dto/get-chat-history.dto';

@Controller('ai-assistant')
@UseGuards(JwtAuthGuard)
export class AiAssistantController {
  constructor(private readonly aiAssistantService: AiAssistantService) {}

  /**
   * Query the AI assistant with a question
   * POST /ai-assistant/query
   */
  @Post('query')
  @HttpCode(HttpStatus.OK)
  async query(@Body() queryDto: QueryAiDto, @Req() req) {
    return this.aiAssistantService.queryAi(queryDto, req.user.id);
  }

  /**
   * Get user's chat history
   * GET /ai-assistant/history
   */
  @Get('history')
  async getChatHistory(@Query() queryDto: GetChatHistoryDto, @Req() req) {
    return this.aiAssistantService.getChatHistory(req.user.id, queryDto);
  }

  /**
   * Get a specific chat message
   * GET /ai-assistant/history/:id
   */
  @Get('history/:id')
  async getChatMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
  ) {
    return this.aiAssistantService.getChatMessage(id, req.user.id);
  }

  /**
   * Delete a chat message
   * DELETE /ai-assistant/history/:id
   */
  @Delete('history/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteChatMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
  ) {
    return this.aiAssistantService.deleteChatMessage(id, req.user.id);
  }
}

