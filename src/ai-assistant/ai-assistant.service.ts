import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiChatMessage, MessageRole } from '../entities/ai-chat-message.entity';
import { AiConversation } from '../entities/ai-conversation.entity';
import { User } from '../entities/user.entity';
import { RoomService } from '../room/room.service';
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
    private configService: ConfigService,
    private roomService: RoomService,
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

    const conversation = this.conversationRepository.create({
      user,
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

    // Get user's current room IDs (dynamically fetched)
    const userRoomIds = await this.roomService.getUserRoomIds(userId);

    if (userRoomIds.length === 0) {
      throw new BadRequestException('You must be part of at least one room to query the AI assistant');
    }

    //  Handle attachment processing (only on first message with attachment)
    let attachmentContext: string | null = null;
    let hasVectorAttachment = false;
    let isFirstAttachment = false; // Flag to track if this is first message with attachment
    
    if (messageDto.attachmentS3Url && messageDto.attachmentType && !conversation.attachmentUrl) {
      this.logger.log(
        `[ATTACHMENT] First message with attachment - type=${messageDto.attachmentType}, ` +
        `size=${messageDto.attachmentFileSize || 'unknown'} bytes, S3=${messageDto.attachmentS3Url.substring(0, 50)}...`
      );

      // This is the first message with an attachment for this conversation
      isFirstAttachment = true;
     conversation.attachmentUrl = messageDto.attachmentS3Url;
      conversation.attachmentType = messageDto.attachmentType;
      conversation.attachmentOriginalName = messageDto.attachmentOriginalName || 'Untitled';

      // Wait for FastAPI response to determine flow and update conversation
      // (will be done after the AI response)
    } else if (conversation.attachmentContext) {
      // Subsequent message in conversation with Flow 1 attachment
      attachmentContext = conversation.attachmentContext;
      this.logger.log(
        `[ATTACHMENT] Using stored Flow 1 attachment context (${attachmentContext.length} chars)`
      );
    } else if (conversation.attachmentInVectorDB) {
      // Subsequent message with Flow 2 attachment
      hasVectorAttachment = true;
      this.logger.log(
        `[ATTACHMENT] Using Flow 2 vector storage for conversation ${conversationId}`
      );
    }

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
        `Querying AI for conversation ${conversationId} with ${conversationHistory.length} history messages`
      );

      // Build request payload
      const requestPayload: any = {
        query: messageDto.message,
        user_id: userId,
        room_ids: userRoomIds,
        context_file_id: messageDto.contextFileId || null,
        top_k: messageDto.topK || 5,
        conversation_history: conversationHistory,
        conversation_summary: conversation.summary || null,
        conversation_id: conversationId,
      };

      // Add attachment fields if present
        if (isFirstAttachment) {
      // First message with attachment - send to FastAPI for processing
        requestPayload.attachment_s3_url = messageDto.attachmentS3Url;
        requestPayload.attachment_type = messageDto.attachmentType;
        requestPayload.attachment_file_size = messageDto.attachmentFileSize || 0;
        this.logger.log(
          `[ATTACHMENT] Sending to FastAPI for flow decision - ` +
          `size=${messageDto.attachmentFileSize} bytes, type=${messageDto.attachmentType}`
        );
      } else if (attachmentContext) {
        // Flow 1: Direct injection
        requestPayload.attachment_context = attachmentContext;
        this.logger.log(
          `[ATTACHMENT] Including Flow 1 context in request (${attachmentContext.length} chars)`
        );
      } else if (hasVectorAttachment) {
        // Flow 2: Vector retrieval
        requestPayload.has_vector_attachment = true;
        this.logger.log(
          `[ATTACHMENT] Flagging Flow 2 vector retrieval for conversation ${conversationId}`
        );
      }

      // Call FastAPI with conversation context and attachments
      const response = await axios.post(
        `${this.aiServiceUrl}/query`,
        requestPayload,
        {
          timeout: 60000, // 60 second timeout
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const aiResponse = response.data;

      // Update conversation with attachment processing results (if first message with attachment)
        if (isFirstAttachment) {
      this.logger.log(
          `[ATTACHMENT] FastAPI response - flow_used=${aiResponse.flow_used || 'NONE'}, ` +
          `extracted_content_length=${aiResponse.extracted_content_length || 0}`
        );
        
        if (aiResponse.flow_used === 'direct_injection') {
          // Flow 1: Store extracted content in conversation
          conversation.attachmentContext = aiResponse.extracted_content || null;
          this.logger.log(
            `[ATTACHMENT] ✓ Flow 1 Complete: Stored attachmentContext (${aiResponse.extracted_content_length || 0} chars)`
          );
          this.logger.debug(
            `[ATTACHMENT] attachmentContext preview: ${(aiResponse.extracted_content || '').substring(0, 200)}...`
          );
        } else if (aiResponse.flow_used === 'vector_storage') {
          // Flow 2: Mark as stored in vector DB
          conversation.attachmentInVectorDB = true;
          this.logger.log(
            `[ATTACHMENT] ✓ Flow 2 Complete: Stored in vector DB (${aiResponse.chunks_created_for_attachment || 0} chunks)`
          );
        } else {
          this.logger.warn(
            `[ATTACHMENT] ⚠ No flow_used in response! Check AI service processing.`
          );
        }

        await this.conversationRepository.save(conversation);
        this.logger.log(
          `[ATTACHMENT] Conversation ${conversationId} saved with attachment metadata`
        );

      }

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
    } catch (error: any) {
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
  ): Promise<{ message: string; vectorsDeleted: boolean }> {

    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, user: { id: userId } },
      relations: ['user'], // Explicitly load user relation for verification
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found or you do not have access to it');
    }

    let vectorsDeleted = false;
    let vectorCleanupWarning = '';

    // Cleanup attachment vectors if conversation used Flow 2
    if (conversation.attachmentInVectorDB) {
      try {     
        
        const vectorResponse = await axios.delete(
          `${this.aiServiceUrl}/vectors/conversation/${conversationId}`,
          { timeout: 10000 }
        );

        const deletedCount = vectorResponse.data?.deleted_count || 0;
        vectorsDeleted = true;
        
        this.logger.log(
          `✓ Successfully deleted ${deletedCount} attachment vector(s) for conversation ${conversationId}`
        );
      } catch (error: any) {
        this.logger.error(
          `Failed to delete attachment vectors for conversation ${conversationId}: ${error.message}`,
          error.stack
        );
        vectorCleanupWarning = ' (Note: Attachment vectors cleanup failed but will be removed by TTL expiration)';
        // Don't fail deletion if vector cleanup fails
      }
    }

    try {
      await this.conversationRepository.remove(conversation);
      
      const successMessage = `Conversation "${conversation.title}" deleted successfully${vectorCleanupWarning}`;

      return {
        message: successMessage,
        vectorsDeleted,
      };
    } catch (error: any) {
      throw new BadRequestException(
        `Failed to delete conversation from database: ${error.message}`
      );
    }
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
    } catch (error: any) {
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
    } catch (error: any) {
      this.logger.error(
        `Failed to summarize conversation ${conversationId}: ${error.message}`,
      );
      throw error;
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
      summary: conversation.summary,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };

    // Add attachment metadata if present
    if (conversation.attachmentUrl) {
      response.attachment = {
        url: conversation.attachmentUrl,
        type: conversation.attachmentType!,
        originalName: conversation.attachmentOriginalName!,
        inVectorDB: conversation.attachmentInVectorDB,
      };
    }

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
