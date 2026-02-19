import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
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
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req,
  ): Promise<{ success: boolean; message: string }> {
    await this.aiAssistantService.deleteConversation(id, req.user.id);
    return { success: true, message: 'Conversation deleted successfully.' };
  }

  /**
   * Send a message in a conversation and get AI response
   * POST /ai-assistant/conversations/:id/messages
   */
  @Post('conversations/:id/messages')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() messageDto: SendMessageDto,
    @Req() req,
  ): Promise<MessageResponseDto> {
    return this.aiAssistantService.sendMessage(id, messageDto, req.user.id);
  }
}

