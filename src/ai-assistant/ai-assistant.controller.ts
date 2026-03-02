import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { AiAssistantService } from './ai-assistant.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import {
  CreateConversationDto,
  SendMessageDto,
  ConversationResponseDto,
  MessageResponseDto,
  ConversationWithMessagesDto,
} from './dto';

@Controller('ai-assistant')
@UseGuards(JwtAuthGuard)
export class AiAssistantController {
  constructor(private readonly aiAssistantService: AiAssistantService) {}

  /**
   * Create a new conversation
   * POST /ai-assistant/conversations
   */
  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  async createConversation(
    @Body() createDto: CreateConversationDto,
    @Req() req,
  ): Promise<ConversationResponseDto> {
    return this.aiAssistantService.createConversation(createDto, req.user.id);
  }

  /**
   * Get all conversations for the user
   * GET /ai-assistant/conversations
   */
  @Get('conversations')
  async getConversations(@Req() req): Promise<ConversationResponseDto[]> {
    return this.aiAssistantService.getConversations(req.user.id);
  }

  /**
   * Get a specific conversation with all messages
   * GET /ai-assistant/conversations/:id
   */
  @Get('conversations/:id')
  async getConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
  ): Promise<ConversationWithMessagesDto> {
    return this.aiAssistantService.getConversation(id, req.user.id);
  }

  /**
   * Update conversation title
   * PATCH /ai-assistant/conversations/:id/title
   */
  @Patch('conversations/:id/title')
  async updateConversationTitle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('title') title: string,
    @Req() req,
  ): Promise<ConversationResponseDto> {
    return this.aiAssistantService.updateConversationTitle(
      id,
      title,
      req.user.id,
    );
  }

  /**
   * Delete a conversation
   * DELETE /ai-assistant/conversations/:id
   */
  @Delete('conversations/:id')
  @HttpCode(HttpStatus.OK)
  async deleteConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
  ): Promise<{ success: boolean; message: string; vectorsDeleted?: boolean }> {
    const result = await this.aiAssistantService.deleteConversation(id, req.user.id);
    return {
      success: true,
      message: result.message,
      vectorsDeleted: result.vectorsDeleted,
    };
  }

  /**
   * Send a query message with streaming response (with optional conversationId)
   * POST /ai-assistant/query
   * - If conversationId provided in body: continues existing conversation
   * - If conversationId not provided: auto-creates new conversation
   */
  @Post('query')
  async sendQuery(
    @Body() messageDto: SendMessageDto,
    @Req() req,
    @Res() res: Response,
  ): Promise<void> {
    // Set SSE headers and prevent buffering
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.setHeader('Content-Encoding', 'none'); // Disable compression
    res.setHeader('Transfer-Encoding', 'chunked'); // Enable chunked transfer
    res.flushHeaders();

    await this.aiAssistantService.sendQueryStreamWithAutoConversation(
      messageDto,
      req.user.id,
      res,
    );
  }
}

