import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Response } from 'express';
import { AiChatMessage, MessageRole } from '../entities/ai-chat-message.entity';
import { AiConversation } from '../entities/ai-conversation.entity';
import { ConversationAttachment } from '../entities/conversation-attachment.entity';
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
  private readonly aiServiceApiKey: string;

  constructor(
    @InjectRepository(AiConversation)
    private conversationRepository: Repository<AiConversation>,
    @InjectRepository(AiChatMessage)
    private messageRepository: Repository<AiChatMessage>,
    @InjectRepository(ConversationAttachment)
    private attachmentRepository: Repository<ConversationAttachment>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
    private roomService: RoomService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL') || 'http://localhost:8001';
    this.aiServiceApiKey = this.configService.getOrThrow<string>('AI_SERVICE_API_KEY');
    
    if (!this.aiServiceApiKey) {
      throw new Error('AI_SERVICE_API_KEY environment variable is required');
    }
  }

  /** Maximum number of attachments we allow per conversation. */
  private static readonly MAX_ATTACHMENTS_PER_CONVERSATION = 2;

  /**
   * One-time migration for conversations created before multi-file
   * support. If the legacy scalar columns are set and the new relation
   * is empty, move the legacy data into a proper ConversationAttachment
   * row and clear the scalars. Safe to call on every request — no-op
   * when the conversation is already migrated.
   */
  private async migrateLegacyAttachmentIfNeeded(
    conversation: AiConversation,
  ): Promise<void> {
    if (conversation.attachments && conversation.attachments.length > 0) return;
    if (!conversation.attachmentUrl || !conversation.attachmentType) return;

    const migrated = this.attachmentRepository.create({
      conversation,
      url: conversation.attachmentUrl,
      type: conversation.attachmentType,
      originalName: conversation.attachmentOriginalName || 'Untitled',
      fileSize: null,
      context: conversation.attachmentContext,
      inVectorDB: conversation.attachmentInVectorDB,
    });
    await this.attachmentRepository.save(migrated);

    conversation.attachmentUrl = null;
    conversation.attachmentType = null;
    conversation.attachmentOriginalName = null;
    conversation.attachmentContext = null;
    conversation.attachmentInVectorDB = false;
    await this.conversationRepository.save(conversation);

    conversation.attachments = [migrated];
    this.logger.log(
      `[ATTACHMENT] Migrated legacy attachment for conversation ${conversation.id} into relation`,
    );
  }

  /**
   * Combine all Flow 1 attachment texts into a single prompt-ready
   * string. Each file is labelled so the LLM can distinguish them.
   * Returns null when no Flow 1 attachments exist.
   */
  private buildCombinedAttachmentContext(
    attachments: ConversationAttachment[],
  ): string | null {
    const parts = attachments
      .filter((a) => a.context)
      .map((a) => `## File: ${a.originalName}\n\n${a.context}`);
    if (parts.length === 0) return null;
    return parts.join('\n\n---\n\n');
  }

  /**
   * Clear any previously-attached file context from a conversation so a new
   * attachment can replace it. Deletes Flow 2 vectors from FastAPI if they
   * exist. Caller must still persist the conversation afterward.
   */
  private async clearConversationAttachment(
    conversation: AiConversation,
  ): Promise<void> {
    if (conversation.attachmentInVectorDB) {
      try {
        await axios.delete(
          `${this.aiServiceUrl}/vectors/conversation/${conversation.id}`,
          {
            timeout: 10000,
            headers: { 'X-API-Key': this.aiServiceApiKey },
          },
        );
        this.logger.log(
          `[ATTACHMENT] Cleared Flow 2 vectors for conversation ${conversation.id} to replace attachment`,
        );
      } catch (err: any) {
        this.logger.warn(
          `[ATTACHMENT] Failed to delete old vectors for conversation ${conversation.id}: ${err.message}. Proceeding anyway.`,
        );
      }
    }
    conversation.attachmentUrl = null;
    conversation.attachmentType = null;
    conversation.attachmentOriginalName = null;
    conversation.attachmentContext = null;
    conversation.attachmentInVectorDB = false;
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
   * Send a query with optional conversation - creates conversation if not provided (streaming)
   */
  async sendQueryStreamWithAutoConversation(
    messageDto: SendMessageDto,
    userId: string,
    res: Response,
  ): Promise<void> {
    let conversationId = messageDto.conversationId;

    // If no conversationId provided, create a new conversation
    if (!conversationId) {
      const conversation = await this.createConversation({}, userId);
      conversationId = conversation.id;
      
      this.logger.log(
        `Auto-created conversation ${conversationId} for streaming query: "${messageDto.message.substring(0, 50)}..."`
      );
    } else {
      this.logger.log(
        `Using existing conversation ${conversationId} for streaming query: "${messageDto.message.substring(0, 50)}..."`
      );
    }

    // Send initial event with conversation_id (important for new conversations)
    res.write(`event: conversation\ndata: ${JSON.stringify({ conversation_id: conversationId })}\n\n`);
    
    // Flush immediately to establish stream
    if (typeof (res as any).flush === 'function') {
      (res as any).flush();
    }

    // Send message to the conversation (streaming)
    await this.sendMessageStream(
      conversationId,
      messageDto,
      userId,
      res,
    );
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

    // Handle attachment processing. A conversation can have at most one
    // "active" attachment; attaching a new file replaces the previous one.
    let attachmentContext: string | null = null;
    let hasVectorAttachment = false;
    let isFirstAttachment = false;

    const incomingAttachment = !!(
      messageDto.attachmentS3Url && messageDto.attachmentType
    );
    const priorAttachmentIncomplete =
      !!conversation.attachmentUrl &&
      !conversation.attachmentContext &&
      !conversation.attachmentInVectorDB;
    const isReplacingAttachment =
      incomingAttachment &&
      !!conversation.attachmentUrl &&
      messageDto.attachmentS3Url !== conversation.attachmentUrl;

    if (incomingAttachment && (isReplacingAttachment || priorAttachmentIncomplete)) {
      this.logger.log(
        `[ATTACHMENT] Replacing prior attachment for conversation ${conversationId}`,
      );
      await this.clearConversationAttachment(conversation);
    }

    if (incomingAttachment && !conversation.attachmentUrl) {
      this.logger.log(
        `[ATTACHMENT] First message with attachment - type=${messageDto.attachmentType}, ` +
        `size=${messageDto.attachmentFileSize || 'unknown'} bytes, S3=${messageDto.attachmentS3Url!.substring(0, 50)}...`
      );

      isFirstAttachment = true;
      conversation.attachmentUrl = messageDto.attachmentS3Url!;
      conversation.attachmentType = messageDto.attachmentType!;
      conversation.attachmentOriginalName = messageDto.attachmentOriginalName || 'Untitled';
    } else if (conversation.attachmentContext) {
      attachmentContext = conversation.attachmentContext;
      this.logger.log(
        `[ATTACHMENT] Using stored Flow 1 attachment context (${attachmentContext.length} chars)`
      );
    } else if (conversation.attachmentInVectorDB) {
      hasVectorAttachment = true;
      this.logger.log(
        `[ATTACHMENT] Using Flow 2 vector storage for conversation ${conversationId}`
      );
    }

    // Save user message (include attachment metadata so the UI can render
    // the file pill on this specific bubble after a refresh).
    const userMessage = this.messageRepository.create({
      conversation,
      user: conversation.user,
      role: MessageRole.USER,
      content: messageDto.message,
      contextFileId: messageDto.contextFileId || null,
      attachmentOriginalName:
        messageDto.attachmentOriginalName || null,
      attachmentType: messageDto.attachmentType || null,
      attachmentFileSize: messageDto.attachmentFileSize ?? null,
      attachmentUrl: messageDto.attachmentS3Url || null,
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
            'X-API-Key': this.aiServiceApiKey,
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
      relations: ['attachments'],
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
      relations: ['attachments'],
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
      relations: ['user', 'attachments'],
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found or you do not have access to it');
    }

    let vectorsDeleted = false;
    let vectorCleanupWarning = '';

    // Cleanup attachment vectors if any attachment (legacy or new) used Flow 2.
    const hasAnyVectorAttachment =
      conversation.attachmentInVectorDB ||
      (conversation.attachments || []).some((a) => a.inVectorDB);
    if (hasAnyVectorAttachment) {
      try {     
        
        const vectorResponse = await axios.delete(
          `${this.aiServiceUrl}/vectors/conversation/${conversationId}`,
          { 
            timeout: 10000,
            headers: {
              'X-API-Key': this.aiServiceApiKey,
            },
          }
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
   * Send a message in a conversation and stream AI response from FastAPI
   */
  async sendMessageStream(
    conversationId: string,
    messageDto: SendMessageDto,
    userId: string,
    res: Response,
  ): Promise<void> {
    // Load conversation with its attachments. The 'attachments' relation
    // is the current source of truth; legacy scalar columns are migrated
    // on the fly by migrateLegacyAttachmentIfNeeded.
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId, user: { id: userId } },
      relations: ['user', 'attachments'],
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    await this.migrateLegacyAttachmentIfNeeded(conversation);

    // Get user's current room IDs (dynamically fetched)
    const userRoomIds = await this.roomService.getUserRoomIds(userId);

    if (userRoomIds.length === 0) {
      throw new BadRequestException('You must be part of at least one room to query the AI assistant');
    }

    // Multi-file attachment handling.
    // - Incoming attachment already attached (same URL) → no-op, reuse stored context.
    // - Incoming attachment new → create a row, subject to the cap of
    //   MAX_ATTACHMENTS_PER_CONVERSATION. Reject with 400 if exceeded.
    // - No incoming attachment → just reuse all stored attachments' contexts.
    let attachmentContext: string | null = null;
    let hasVectorAttachment = false;
    let isFirstAttachment = false;
    let newAttachment: ConversationAttachment | null = null;

    const incomingAttachment = !!(
      messageDto.attachmentS3Url && messageDto.attachmentType
    );

    const currentAttachments = conversation.attachments || [];

    if (incomingAttachment) {
      const alreadyAttached = currentAttachments.find(
        (a) => a.url === messageDto.attachmentS3Url,
      );

      if (!alreadyAttached) {
        if (currentAttachments.length >= AiAssistantService.MAX_ATTACHMENTS_PER_CONVERSATION) {
          // Headers are already flushed by the controller, so we can't
          // throw and let the exception filter respond — that crashes
          // with ERR_HTTP_HEADERS_SENT. Emit the error as an SSE event
          // (frontend's useStreamQuery handles `event: error`) and end
          // the stream cleanly.
          const errorPayload = {
            error: `This conversation already has the maximum of ${AiAssistantService.MAX_ATTACHMENTS_PER_CONVERSATION} attached files. Start a new conversation or remove one before attaching another.`,
          };
          this.logger.warn(
            `[ATTACHMENT] Rejected 3rd attachment for conversation ${conversationId}`,
          );
          res.write(`event: error\ndata: ${JSON.stringify(errorPayload)}\n\n`);
          if (typeof (res as any).flush === 'function') (res as any).flush();
          res.end();
          return;
        }

        newAttachment = this.attachmentRepository.create({
          conversation,
          url: messageDto.attachmentS3Url!,
          type: messageDto.attachmentType!,
          originalName: messageDto.attachmentOriginalName || 'Untitled',
          fileSize: messageDto.attachmentFileSize ?? null,
          context: null,
          inVectorDB: false,
        });
        await this.attachmentRepository.save(newAttachment);
        currentAttachments.push(newAttachment);
        conversation.attachments = currentAttachments;

        isFirstAttachment = true;
        this.logger.log(
          `[ATTACHMENT] Added file #${currentAttachments.length}/` +
          `${AiAssistantService.MAX_ATTACHMENTS_PER_CONVERSATION} to conversation ${conversationId} ` +
          `— type=${messageDto.attachmentType}, size=${messageDto.attachmentFileSize || 'unknown'}`,
        );
      } else {
        this.logger.log(
          `[ATTACHMENT] Incoming file already attached to conversation ${conversationId} — reusing stored context`,
        );
      }
    }

    // Build combined Flow 1 context from all stored attachments that have
    // already been processed (previous files). The new file's context is
    // still empty at this point — FastAPI will extract it and we'll save
    // it after the response.
    attachmentContext = this.buildCombinedAttachmentContext(currentAttachments);

    // Flow 2 flag is true if ANY attachment lives in the vector DB.
    hasVectorAttachment = currentAttachments.some((a) => a.inVectorDB);

    if (attachmentContext) {
      this.logger.log(
        `[ATTACHMENT] Using combined Flow 1 context from ${currentAttachments.filter((a) => a.context).length} file(s), ` +
        `${attachmentContext.length} chars total`,
      );
    }

    // Save user message (include attachment metadata so the UI can render
    // the file pill on this specific bubble after a refresh).
    const userMessage = this.messageRepository.create({
      conversation,
      user: conversation.user,
      role: MessageRole.USER,
      content: messageDto.message,
      contextFileId: messageDto.contextFileId || null,
      attachmentOriginalName:
        messageDto.attachmentOriginalName || null,
      attachmentType: messageDto.attachmentType || null,
      attachmentFileSize: messageDto.attachmentFileSize ?? null,
      attachmentUrl: messageDto.attachmentS3Url || null,
    });

    await this.messageRepository.save(userMessage);

    // Auto-generate title from first message if still default
    if (conversation.title === 'New Conversation') {
      conversation.title = this.generateConversationTitle(messageDto.message);
      await this.conversationRepository.save(conversation);
      
      // Send title update event to frontend
      res.write(`event: title\ndata: ${JSON.stringify({ title: conversation.title })}\n\n`);
      
      // Flush immediately
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
      
      this.logger.log(`Auto-generated title: "${conversation.title}"`);
    }

    // Fetch recent conversation history (last 8 messages, ascending order)
    const recentMessagesDesc = await this.messageRepository.find({
      where: { conversation: { id: conversationId } },
      order: { createdAt: 'DESC' },
      take: 8,
    });

    const recentMessages = recentMessagesDesc.reverse();

    // Build conversation history for FastAPI
    const conversationHistory = recentMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      this.logger.log(
        `Streaming query for conversation ${conversationId} with ${conversationHistory.length} history messages`
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

      // Attachment fields — with multi-file support, these are not
      // mutually exclusive. A query can simultaneously:
      //  - carry stored context from prior files (attachment_context),
      //  - ask FastAPI to process a newly added file (attachment_s3_url),
      //  - flag that some attachment lives in Qdrant (has_vector_attachment).
      // FastAPI combines whichever arrive.
      if (attachmentContext) {
        requestPayload.attachment_context = attachmentContext;
        this.logger.log(
          `[ATTACHMENT] Including stored context for ${currentAttachments.filter((a) => a.context).length} file(s), ${attachmentContext.length} chars`,
        );
      }
      if (isFirstAttachment) {
        requestPayload.attachment_s3_url = messageDto.attachmentS3Url;
        requestPayload.attachment_type = messageDto.attachmentType;
        requestPayload.attachment_file_size = messageDto.attachmentFileSize || 0;
        requestPayload.attachment_original_name =
          messageDto.attachmentOriginalName || 'Untitled';
        this.logger.log(
          `[ATTACHMENT] Also sending new file for flow decision - size=${messageDto.attachmentFileSize} bytes, type=${messageDto.attachmentType}`,
        );
      }
      if (hasVectorAttachment) {
        requestPayload.has_vector_attachment = true;
        this.logger.log(
          `[ATTACHMENT] Flagging Flow 2 vector retrieval for conversation ${conversationId}`,
        );
      }

      // Call FastAPI streaming endpoint
      const response = await axios.post(
        `${this.aiServiceUrl}/query/stream`,
        requestPayload,
        {
          responseType: 'stream', // Stream the response
          timeout: 120000, // 2 minute timeout for streaming
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': this.aiServiceApiKey,
          },
        },
      );

      // Variables to collect response data for database
      let fullAnswer = '';
      let sources: any[] = [];
      let chunksRetrieved = 0;
      let processingTimeMs = 0;
      let attachmentFlowUsed: string | null = null;
      let extractedContent: string | null = null;
      let extractedContentLength: number | null = null;
      let chunksCreatedForAttachment: number | null = null;

      // Pipe FastAPI stream to frontend with data collection
      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.substring(6));
              
              // Collect answer chunks
              if (eventData.text) {
                fullAnswer += eventData.text;
              }
              
              // Collect metadata from complete event
              if (eventData.sources) {
                sources = eventData.sources;
              }
              if (eventData.chunks_retrieved !== undefined) {
                chunksRetrieved = eventData.chunks_retrieved;
              }
              if (eventData.processing_time_ms !== undefined) {
                processingTimeMs = eventData.processing_time_ms;
              }
              if (eventData.flow_used) {
                attachmentFlowUsed = eventData.flow_used;
              }
              if (eventData.extracted_content) {
                extractedContent = eventData.extracted_content;
              }
              if (eventData.extracted_content_length) {
                extractedContentLength = eventData.extracted_content_length;
              }
              if (eventData.chunks_created_for_attachment) {
                chunksCreatedForAttachment = eventData.chunks_created_for_attachment;
              }
            } catch (e) {
              // Ignore parse errors for partial chunks
            }
          }
        }
        
        // Forward chunk to frontend and flush immediately
        res.write(chunk);
        
        // Explicitly flush the response to prevent buffering
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }
      });

      response.data.on('end', async () => {
        this.logger.log('Stream completed, saving to database');
        
        try {
          // Persist the newly-added attachment's processing result onto
          // the ConversationAttachment row (not the legacy scalar
          // columns). This lets each file keep its own Flow 1 context or
          // Flow 2 flag without conflicting with other attachments in
          // the same conversation.
          if (isFirstAttachment && newAttachment && attachmentFlowUsed) {
            this.logger.log(
              `[ATTACHMENT] FastAPI response - flow_used=${attachmentFlowUsed}, ` +
              `extracted_content_length=${extractedContentLength || 0}`
            );

            if (attachmentFlowUsed === 'direct_injection') {
              newAttachment.context = extractedContent || null;
              this.logger.log(
                `[ATTACHMENT] ✓ Flow 1 Complete: Stored attachment context (${extractedContentLength || 0} chars) on attachment ${newAttachment.id}`
              );
            } else if (attachmentFlowUsed === 'vector_storage') {
              newAttachment.inVectorDB = true;
              this.logger.log(
                `[ATTACHMENT] ✓ Flow 2 Complete: Stored in vector DB (${chunksCreatedForAttachment || 0} chunks) for attachment ${newAttachment.id}`
              );
            }

            await this.attachmentRepository.save(newAttachment);
          }

          // Save assistant message to database
          const assistantMessage = this.messageRepository.create({
            conversation,
            user: conversation.user,
            role: MessageRole.ASSISTANT,
            content: fullAnswer,
            contextFileId: messageDto.contextFileId || null,
            sources: sources,
            chunksRetrieved: chunksRetrieved,
            processingTimeMs: processingTimeMs,
          });

          await this.messageRepository.save(assistantMessage);

          // Update conversation timestamp
          await this.conversationRepository.update(conversationId, {
            updatedAt: new Date(),
          });

          // Check if we need to trigger summarization (non-blocking)
          this.checkAndTriggerSummarization(conversationId);

          this.logger.log('Assistant message saved to database');
        } catch (error: any) {
          this.logger.error(`Failed to save message: ${error.message}`, error.stack);
        }

        res.end();
      });

      response.data.on('error', (error: any) => {
        this.logger.error(`Stream error: ${error.message}`, error.stack);
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      });

    } catch (error: any) {
      this.logger.error(`AI streaming query failed: ${error.message}`, error.stack);

      // SSE headers are already sent (flushed in controller), so we can't throw
      // HTTP exceptions — NestJS exception filters won't work. Instead, send
      // an SSE error event so the frontend can display the error properly.
      const errorMessage = error.response?.data?.detail
        || error.response?.statusText
        || error.message
        || 'AI service error';

      try {
        res.write(`event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`);
        res.end();
      } catch (writeError) {
        this.logger.error(`Failed to write SSE error event: ${(writeError as any).message}`);
        try { res.end(); } catch { /* connection already closed */ }
      }
    }
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
            'X-API-Key': this.aiServiceApiKey,
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

    // Attachment metadata — prefer the multi-file relation, fall back
    // to legacy scalar columns for conversations not yet migrated.
    const relationAttachments = (conversation.attachments || []).map((a) => ({
      url: a.url,
      type: a.type,
      originalName: a.originalName,
      inVectorDB: a.inVectorDB,
    }));
    if (relationAttachments.length > 0) {
      response.attachments = relationAttachments;
      // Keep the legacy single-attachment field populated with the first
      // one for any frontend code still reading it.
      response.attachment = relationAttachments[0];
    } else if (conversation.attachmentUrl) {
      const legacy = {
        url: conversation.attachmentUrl,
        type: conversation.attachmentType!,
        originalName: conversation.attachmentOriginalName!,
        inVectorDB: conversation.attachmentInVectorDB,
      };
      response.attachment = legacy;
      response.attachments = [legacy];
    } else {
      response.attachments = [];
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
      attachmentOriginalName: message.attachmentOriginalName ?? null,
      attachmentType: message.attachmentType ?? null,
      attachmentFileSize: message.attachmentFileSize ?? null,
      attachmentUrl: message.attachmentUrl ?? null,
    };
  }
}
