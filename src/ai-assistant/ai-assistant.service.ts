import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiChatMessage, MessageRole } from '../entities/ai-chat-message.entity';
import { AiConversation } from '../entities/ai-conversation.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { RoomMember } from '../entities/room-member.entity';
import {
  CreateConversationDto,
  SendMessageDto,
  ConversationResponseDto,
  MessageResponseDto,
  ConversationWithMessagesDto,
} from './dto';

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private readonly aiServiceUrl: string;

  constructor(
    @InjectRepository(AiConversation)
    private conversationRepository: Repository<AiConversation>,
    @InjectRepository(AiChatMessage)
    private messageRepository: Repository<AiChatMessage>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
    @InjectRepository(RoomMember)
    private roomMemberRepository: Repository<RoomMember>,
    private configService: ConfigService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL') || 'http://localhost:8001';
  }

  /**
   * Create a new conversation
   */
  async createConversation(
    createDto: CreateConversationDto,
    userId: string,
  ): Promise<ConversationResponseDto> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validate user has access to all rooms
    await this.validateUserRoomAccess(userId, createDto.roomIds);

    const conversation = this.conversationRepository.create({
      user,
      roomIds: createDto.roomIds,
      title: createDto.title || 'New Conversation',
    });

    const saved = await this.conversationRepository.save(conversation);

    return this.formatConversationResponse(saved);
  }

  /**
   * Send a message in a conversation and get AI response
   */
  async sendMessage(
    conversationId: string,
    messageDto: SendMessageDto,
    userId: string,
  ): Promise<MessageResponseDto> {
    // Get conversation and validate access
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, user: { id: userId } },
      relations: ['user'],
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    // Validate room access
    await this.validateUserRoomAccess(userId, conversation.roomIds);

    // Save user message
    const userMessage = this.messageRepository.create({
      conversation,
      user: conversation.user,
      role: MessageRole.USER,
      content: messageDto.message,
      contextFileId: messageDto.contextFileId || null,
    });

    await this.messageRepository.save(userMessage);

    // Auto-generate title from first user message if still default
    if (conversation.title === 'New Conversation') {
      conversation.title = this.generateConversationTitle(messageDto.message);
      await this.conversationRepository.save(conversation);
    }

    // Fetch recent conversation history (last 8 messages, ascending order)
    // We fetch in DESC order, take 8, then reverse to get ASC
    const recentMessagesDesc = await this.messageRepository.find({
      where: { conversation: { id: conversationId } },
      order: { createdAt: 'DESC' },
      take: 8,
    });

    // Reverse to get chronological order (oldest to newest)
    const recentMessages = recentMessagesDesc.reverse();

    // Build conversation history for FastAPI
    const conversationHistory = recentMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      this.logger.log(
        `Querying AI for conversation ${conversationId} with ${conversationHistory.length} history messages`,
      );

      // Call FastAPI with conversation context
      const response = await axios.post(
        `${this.aiServiceUrl}/query`,
        {
          query: messageDto.message,
          user_id: userId,
          room_ids: conversation.roomIds,
          context_file_id: messageDto.contextFileId || null,
          top_k: messageDto.topK || 5,
          conversation_history: conversationHistory,
          conversation_summary: conversation.summary || null,
        },
        {
          timeout: 60000, // 60 second timeout for longer conversations
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const aiResponse = response.data;

      // Save assistant message
      const assistantMessage = this.messageRepository.create({
        conversation,
        user: conversation.user,
        role: MessageRole.ASSISTANT,
        content: aiResponse.answer,
        contextFileId: messageDto.contextFileId || null,
        sources: aiResponse.sources,
        chunksRetrieved: aiResponse.chunks_retrieved,
        processingTimeMs: aiResponse.processing_time_ms,
      });

      const savedAssistantMessage = await this.messageRepository.save(assistantMessage);

      // Update conversation timestamp
      await this.conversationRepository.update(conversationId, {
        updatedAt: new Date(),
      });

      // Check if we need to trigger summarization (non-blocking)
      this.checkAndTriggerSummarization(conversationId);

      return this.formatMessageResponse(savedAssistantMessage);
    } catch (error) {
      this.logger.error(`AI query failed: ${error.message}`, error.stack);

      if (error.response) {
        const status = error.response.status;
        const detail = error.response.data?.detail || 'AI service error';

        if (status === 404) {
          throw new NotFoundException(`AI service error: ${detail}`);
        } else if (status >= 400 && status < 500) {
          throw new BadRequestException(`AI service error: ${detail}`);
        }
      }

      throw new BadRequestException(
        `Failed to query AI assistant: ${error.message}`,
      );
    }
  }

  /**
   * Get all conversations for a user
   */
  async getConversations(userId: string): Promise<ConversationResponseDto[]> {
    const conversations = await this.conversationRepository.find({
      where: { user: { id: userId } },
      order: { updatedAt: 'DESC' },
    });

    const formatted = await Promise.all(
      conversations.map((conv) => this.formatConversationResponse(conv, true)),
    );

    return formatted;
  }

  /**
   * Get a specific conversation with all messages
   */
  async getConversation(
    conversationId: string,
    userId: string,
  ): Promise<ConversationWithMessagesDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, user: { id: userId } },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const messages = await this.messageRepository.find({
      where: { conversation: { id: conversationId } },
      order: { createdAt: 'ASC' },
    });

    const conversationData = await this.formatConversationResponse(conversation);

    return {
      ...conversationData,
      messages: messages.map((msg) => this.formatMessageResponse(msg)),
    };
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, user: { id: userId } },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.conversationRepository.remove(conversation);
  }

  /**
   * Update conversation title
   */
  async updateConversationTitle(
    conversationId: string,
    title: string,
    userId: string,
  ): Promise<ConversationResponseDto> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, user: { id: userId } },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    conversation.title = title;
    const updated = await this.conversationRepository.save(conversation);

    return this.formatConversationResponse(updated);
  }

  /**
   * Check if summarization is needed and trigger it (non-blocking)
   */
  private async checkAndTriggerSummarization(conversationId: string): Promise<void> {
    try {
      const messageCount = await this.messageRepository.count({
        where: { conversation: { id: conversationId } },
      });

      // Trigger summarization at multiples of 10
      if (messageCount > 0 && messageCount % 10 === 0) {
        this.logger.log(
          `Triggering background summarization for conversation ${conversationId} (${messageCount} messages)`,
        );

        // Fire and forget - don't await
        this.summarizeConversation(conversationId).catch((error) => {
          this.logger.error(
            `Background summarization failed for conversation ${conversationId}: ${error.message}`,
          );
        });
      }
    } catch (error) {
      this.logger.error(`Failed to check summarization: ${error.message}`);
    }
  }

  /**
   * Summarize a conversation (background task)
   */
  private async summarizeConversation(conversationId: string): Promise<void> {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });

    if (!conversation) {
      return;
    }

    // Get all messages except the last 8
    const allMessages = await this.messageRepository.find({
      where: { conversation: { id: conversationId } },
      order: { createdAt: 'ASC' },
    });

    if (allMessages.length <= 8) {
      return; // Not enough messages to summarize
    }

    const messagesToSummarize = allMessages.slice(0, -8);

    const formattedMessages = messagesToSummarize.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      const response = await axios.post(
        `${this.aiServiceUrl}/utils/summarize-conversation`,
        {
          messages: formattedMessages,
          existing_summary: conversation.summary || null,
        },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const newSummary = response.data.summary;

      // Save summary
      await this.conversationRepository.update(conversationId, {
        summary: newSummary,
      });

      this.logger.log(
        `Successfully summarized conversation ${conversationId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to summarize conversation ${conversationId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Validate that user has access to all requested rooms
   */
  private async validateUserRoomAccess(
    userId: string,
    roomIds: string[],
  ): Promise<void> {
    for (const roomId of roomIds) {
      const room = await this.roomRepository.findOne({
        where: { id: roomId },
      });

      if (!room) {
        throw new NotFoundException(`Room ${roomId} not found`);
      }

      const membership = await this.roomMemberRepository.findOne({
        where: {
          room: { id: roomId },
          user: { id: userId },
        },
      });

      if (!membership) {
        throw new BadRequestException(
          `You do not have access to room ${roomId}`,
        );
      }
    }
  }

  /**
   * Generate conversation title from first message
   */
  private generateConversationTitle(firstMessage: string): string {
    const maxLength = 50;
    if (firstMessage.length <= maxLength) {
      return firstMessage;
    }
    return firstMessage.substring(0, maxLength - 3) + '...';
  }

  /**
   * Format conversation for response
   */
  private async formatConversationResponse(
    conversation: AiConversation,
    includeStats = false,
  ): Promise<ConversationResponseDto> {
    const response: ConversationResponseDto = {
      id: conversation.id,
      title: conversation.title,
      roomIds: conversation.roomIds,
      summary: conversation.summary,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };

    if (includeStats) {
      const messageCount = await this.messageRepository.count({
        where: { conversation: { id: conversation.id } },
      });

      const lastMessage = await this.messageRepository.findOne({
        where: { conversation: { id: conversation.id } },
        order: { createdAt: 'DESC' },
      });

      response.messageCount = messageCount;
      response.lastMessage = lastMessage
        ? this.formatMessageResponse(lastMessage)
        : undefined;
    }

    return response;
  }

  /**
   * Format message for response
   */
  private formatMessageResponse(message: AiChatMessage): MessageResponseDto {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      contextFileId: message.contextFileId,
      sources: message.sources,
      chunksRetrieved: message.chunksRetrieved,
      processingTimeMs: message.processingTimeMs,
      createdAt: message.createdAt,
    };
  }
}
