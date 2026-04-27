import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Response } from 'express';
import { AiChatMessage, MessageRole } from '../entities/ai-chat-message.entity';
import { AiConversation, AttachmentType } from '../entities/ai-conversation.entity';
import { ConversationAttachment } from '../entities/conversation-attachment.entity';
import { User } from '../entities/user.entity';
import { RoomService } from '../room/room.service';
import { FileService } from '../file/file.service';
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
    private fileService: FileService,
  ) {
    this.aiServiceUrl = this.configService.get<string>('AI_SERVICE_URL') || 'http://localhost:8001';
    this.aiServiceApiKey = this.configService.getOrThrow<string>('AI_SERVICE_API_KEY');
    
    if (!this.aiServiceApiKey) {
      throw new Error('AI_SERVICE_API_KEY environment variable is required');
    }
  }

  /** Maximum number of attachments we allow per conversation. */
  private static readonly MAX_ATTACHMENTS_PER_CONVERSATION = 3;

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
  /**
   * Map a file's mime type / filename to the AttachmentType enum used by
   * ConversationAttachment. Used when persisting a room-file pick — the
   * room File entity has a looser FileType (document/image/...) and a
   * mime, but ConversationAttachment uses AttachmentType (pdf/docx/pptx/
   * txt/image), so we derive it here. Falls back to `txt` if nothing
   * matches; the value is mostly cosmetic at this layer because the
   * extracted text is already sitting in `context`.
   */
  private static mimeToAttachmentType(
    mimeType: string | null | undefined,
    originalName: string | null | undefined,
  ): AttachmentType {
    const m = (mimeType || '').toLowerCase();
    const n = (originalName || '').toLowerCase();
    const has = (s: string) => m.includes(s) || n.endsWith('.' + s);
    if (has('pdf')) return AttachmentType.PDF;
    if (m.includes('wordprocessingml') || has('docx')) return AttachmentType.DOCX;
    if (m.includes('presentation') || has('pptx')) return AttachmentType.PPTX;
    if (m.startsWith('image/') || has('png') || has('jpg') || has('jpeg') || has('gif') || has('webp')) {
      return AttachmentType.IMAGE;
    }
    return AttachmentType.TXT;
  }

  /**
   * Build the structured list of previously-extracted attachments to send
   * to FastAPI. Ordered LATEST-FIRST (newest createdAt first) so the AI
   * service can tag the most-recent file as "this file" when the user asks
   * a generic follow-up like "summarize this file".
   *
   * Rows with no context (failed extraction or pure Flow 2) are filtered
   * out — Flow 2 attachments are signalled via has_vector_attachment
   * separately, and failed rows are now deleted on the spot, so this list
   * cleanly represents Flow 1 stored text only.
   */
  private buildStoredAttachments(
    attachments: ConversationAttachment[],
  ): Array<{ name: string; content: string }> {
    return attachments
      .filter((a) => a.context)
      .slice()
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((a) => ({ name: a.originalName, content: a.context as string }));
  }

  /**
   * Persist or clean up the new attachment row after FastAPI has finished
   * (or failed). On success, set `context` (Flow 1) or `inVectorDB` (Flow
   * 2). On any failure mode — FastAPI errored, stream cancelled, empty
   * extraction — delete the row. Keeping zombie rows around blocks future
   * retries of the same S3 URL (URL-based dedup) and eats slots toward the
   * MAX_ATTACHMENTS_PER_CONVERSATION cap.
   */
  private async finalizeAttachmentRow(
    newAttachment: ConversationAttachment | null,
    attachmentFlowUsed: string | null,
    extractedContent: string | null,
    extractedContentLength: number | null,
    chunksCreatedForAttachment: number | null,
  ): Promise<void> {
    if (!newAttachment) return;

    if (attachmentFlowUsed === 'direct_injection' && extractedContent) {
      newAttachment.context = extractedContent;
      await this.attachmentRepository.save(newAttachment);
      this.logger.log(
        `[ATTACHMENT] ✓ Flow 1 Complete: Stored attachment context ` +
          `(${extractedContentLength || 0} chars) on attachment ${newAttachment.id}`,
      );
    } else if (attachmentFlowUsed === 'vector_storage') {
      newAttachment.inVectorDB = true;
      await this.attachmentRepository.save(newAttachment);
      this.logger.log(
        `[ATTACHMENT] ✓ Flow 2 Complete: Stored in vector DB ` +
          `(${chunksCreatedForAttachment || 0} chunks) for attachment ${newAttachment.id}`,
      );
    } else {
      // Either FastAPI never returned a flow_used (errored mid-stream,
      // user cancelled, etc.) or direct_injection produced empty text.
      // Either way the row is useless — delete it so the same URL can be
      // retried and the slot is freed.
      await this.attachmentRepository
        .delete(newAttachment.id)
        .catch(() => undefined);
      this.logger.warn(
        `[ATTACHMENT] Extraction failed for ${newAttachment.id} ` +
          `(flow=${attachmentFlowUsed || 'none'}, content=${extractedContentLength || 0} chars) — row removed`,
      );
    }
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

    // Gate: AI Assistant requires a paid plan
    const { getPlanLimits } = await import('../subscription/plan-limits.const');
    if (!getPlanLimits(user.subscriptionTier).hasAiAssistant) {
      throw new ForbiddenException(
        'AI Assistant requires a paid plan. Please upgrade to use this feature.',
      );
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
    // Gate: AI Assistant requires a paid plan
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const { getPlanLimits } = await import('../subscription/plan-limits.const');
    if (!getPlanLimits(user.subscriptionTier).hasAiAssistant) {
      throw new ForbiddenException(
        'AI Assistant requires a paid plan. Please upgrade to use this feature.',
      );
    }

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

      // Enrich sources with original filenames so the UI can show e.g.
      // "lecture-3.pdf" instead of an opaque file_id UUID.
      const enrichedSources = await this.fileService.enrichSourcesWithFileNames(
        aiResponse.sources,
      );

      // Save assistant message
      const assistantMessage = this.messageRepository.create({
        conversation,
        user: conversation.user,
        role: MessageRole.ASSISTANT,
        content: aiResponse.answer,
        contextFileId: messageDto.contextFileId || null,
        sources: enrichedSources,
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
    //
    // Cap and dedup look only at *successful* attachments (those with
    // either Flow 1 context or Flow 2 vectors). Failed extractions are
    // now deleted on the spot, but old null-context rows from before that
    // fix should not block new uploads either.
    let storedAttachments: Array<{ name: string; content: string }> = [];
    let hasVectorAttachment = false;
    let isFirstAttachment = false;
    let newAttachment: ConversationAttachment | null = null;

    const incomingAttachment = !!(
      messageDto.attachmentS3Url && messageDto.attachmentType
    );

    const currentAttachments = conversation.attachments || [];
    const successfulAttachments = currentAttachments.filter(
      (a) => a.context !== null || a.inVectorDB,
    );

    const sendCapErrorAndEnd = () => {
      const errorPayload = {
        error: `This conversation already has the maximum of ${AiAssistantService.MAX_ATTACHMENTS_PER_CONVERSATION} attached files. Start a new conversation or remove one before attaching another.`,
      };
      this.logger.warn(
        `[ATTACHMENT] Rejected attachment for conversation ${conversationId} (cap reached)`,
      );
      res.write(`event: error\ndata: ${JSON.stringify(errorPayload)}\n\n`);
      if (typeof (res as any).flush === 'function') (res as any).flush();
      res.end();
    };

    if (incomingAttachment) {
      const alreadyAttached = successfulAttachments.find(
        (a) => a.url === messageDto.attachmentS3Url,
      );

      if (!alreadyAttached) {
        if (successfulAttachments.length >= AiAssistantService.MAX_ATTACHMENTS_PER_CONVERSATION) {
          // Headers are already flushed by the controller, so we can't
          // throw and let the exception filter respond — that crashes
          // with ERR_HTTP_HEADERS_SENT. Emit the error as an SSE event
          // (frontend's useStreamQuery handles `event: error`) and end
          // the stream cleanly.
          sendCapErrorAndEnd();
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

    // Room-file attachment: the user picked a file from the in-chat
    // RoomFilePicker. The file is already in S3 and already ingested into
    // Qdrant; instead of re-uploading we ask FastAPI for ALL chunks of
    // the file (ordered by chunk_index), concatenate them, and save the
    // result as a Flow 1 ConversationAttachment. From that point on the
    // room file behaves identically to a personal attachment — counts
    // against the cap, included in stored_attachments on every follow-up,
    // shows up in the file pill, etc.
    const incomingRoomFile = !incomingAttachment && !!messageDto.contextFileId;
    if (incomingRoomFile) {
      const fileId = messageDto.contextFileId!;
      const file = await this.fileService.getRoomFileForRooms(fileId, userRoomIds);
      if (!file) {
        this.logger.warn(
          `[ATTACHMENT] Room file ${fileId} not accessible for user ${userId} — ignoring contextFileId`,
        );
      } else {
        const dedupUrl = `room-file://${fileId}`;
        const alreadyAttached = successfulAttachments.find(
          (a) => a.url === dedupUrl || a.url === file.filePath,
        );

        if (!alreadyAttached) {
          if (
            successfulAttachments.length >=
            AiAssistantService.MAX_ATTACHMENTS_PER_CONVERSATION
          ) {
            sendCapErrorAndEnd();
            return;
          }

          // Pull all chunks for this file from FastAPI; this is preferred
          // over `vector_store.search(file_id)` because broad questions
          // ("summarize this file") don't embed-rank well and would miss
          // sections.
          let concatenated = '';
          let chunkCount = 0;
          try {
            const chunksResp = await axios.get(
              `${this.aiServiceUrl}/vectors/file/${fileId}/all-chunks`,
              {
                timeout: 30000,
                headers: { 'X-API-Key': this.aiServiceApiKey },
              },
            );
            concatenated = chunksResp.data?.content || '';
            chunkCount = chunksResp.data?.chunk_count || 0;
          } catch (err: any) {
            this.logger.error(
              `[ATTACHMENT] Failed to fetch chunks for room file ${fileId}: ${err.message}`,
            );
            const errorPayload = {
              error:
                'Could not load this room file (it may still be processing). Try again in a moment.',
            };
            res.write(`event: error\ndata: ${JSON.stringify(errorPayload)}\n\n`);
            if (typeof (res as any).flush === 'function') (res as any).flush();
            res.end();
            return;
          }

          if (!concatenated) {
            this.logger.warn(
              `[ATTACHMENT] Room file ${fileId} returned empty content — skipping attachment`,
            );
          } else {
            const roomFileRow = this.attachmentRepository.create({
              conversation,
              url: dedupUrl,
              type: AiAssistantService.mimeToAttachmentType(
                file.mimeType,
                file.originalName,
              ),
              originalName: file.originalName,
              fileSize: file.size,
              context: concatenated,
              inVectorDB: false,
            });
            await this.attachmentRepository.save(roomFileRow);
            currentAttachments.push(roomFileRow);
            conversation.attachments = currentAttachments;
            this.logger.log(
              `[ATTACHMENT] Attached room file '${file.originalName}' ` +
                `(${concatenated.length} chars across ${chunkCount} stored chunks) ` +
                `to conversation ${conversationId}`,
            );
          }
        } else {
          this.logger.log(
            `[ATTACHMENT] Room file ${fileId} already attached to conversation ${conversationId} — reusing`,
          );
        }
      }
    }

    // Build the latest-first list of all previously-extracted Flow 1
    // attachments. The new file's context is still empty at this point —
    // FastAPI will extract it and we'll save it after the response.
    storedAttachments = this.buildStoredAttachments(currentAttachments);

    // Flow 2 flag is true if ANY attachment lives in the vector DB.
    hasVectorAttachment = currentAttachments.some((a) => a.inVectorDB);

    if (storedAttachments.length > 0) {
      const totalChars = storedAttachments.reduce(
        (sum, a) => sum + a.content.length,
        0,
      );
      this.logger.log(
        `[ATTACHMENT] Sending ${storedAttachments.length} stored file(s) ` +
          `(latest first), ${totalChars} chars total`,
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
      //  - carry stored context from prior files (stored_attachments),
      //  - ask FastAPI to process a newly added file (attachment_s3_url),
      //  - flag that some attachment lives in Qdrant (has_vector_attachment).
      // FastAPI combines whichever arrive.
      if (storedAttachments.length > 0) {
        requestPayload.stored_attachments = storedAttachments;
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

      // Pipe FastAPI stream to frontend with data collection.
      //
      // SSE events are delimited by a blank line. A single event's
      // `data:` field can be very large (e.g. the `complete` event carries
      // the full extracted_content of an attachment, which can be tens
      // of KBs). Node TCP/HTTP chunk boundaries DO NOT respect SSE event
      // boundaries — large data lines arrive split across chunks. An
      // earlier version split each chunk by '\n' and JSON.parsed each
      // `data:` line independently, which silently dropped any event
      // whose payload didn't fit in a single Buffer chunk.
      //
      // Important: sse_starlette (used by FastAPI's EventSourceResponse)
      // emits CRLF line endings by default, so events arrive as
      //   event: chunk\r\ndata: {...}\r\n\r\n
      // We normalize \r\n → \n on ingress so the rest of the parser can
      // assume LF-only and split on the simpler "\n\n" terminator.
      // Forward raw bytes to the frontend unchanged so its parser still works.
      let parseBuffer = '';
      response.data.on('data', (chunk: Buffer) => {
        // Forward raw bytes to frontend immediately (parser is independent).
        res.write(chunk);
        if (typeof (res as any).flush === 'function') {
          (res as any).flush();
        }

        // Append to buffer and normalize CRLF → LF on the full buffer so
        // a \r/\n pair that landed in two different TCP chunks still
        // collapses correctly.
        parseBuffer = (parseBuffer + chunk.toString('utf8')).replace(/\r\n/g, '\n');
        let eventBoundary = parseBuffer.indexOf('\n\n');
        while (eventBoundary !== -1) {
          const rawEvent = parseBuffer.slice(0, eventBoundary);
          parseBuffer = parseBuffer.slice(eventBoundary + 2);
          eventBoundary = parseBuffer.indexOf('\n\n');

          // An event can have multiple `data:` lines (concatenated per SSE
          // spec) plus an `event:` line. Concatenate the data payload.
          let dataPayload = '';
          for (const line of rawEvent.split('\n')) {
            if (line.startsWith('data:')) {
              dataPayload += line.slice(5).replace(/^ /, '');
            }
          }
          if (!dataPayload) continue;

          let eventData: any;
          try {
            eventData = JSON.parse(dataPayload);
          } catch {
            this.logger.warn(
              `[SSE] Failed to parse event payload (${dataPayload.length} bytes): ${dataPayload.slice(0, 80)}…`,
            );
            continue;
          }

          if (eventData.text) {
            fullAnswer += eventData.text;
          }
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
        }
      });

      response.data.on('end', async () => {
        this.logger.log('Stream completed, saving to database');

        try {
          // Persist the newly-added attachment's processing result, or
          // delete the row if extraction failed. Keeping zombie rows
          // around blocks future retries (URL-based dedup) and eats slots
          // toward the cap.
          await this.finalizeAttachmentRow(
            newAttachment,
            attachmentFlowUsed,
            extractedContent,
            extractedContentLength,
            chunksCreatedForAttachment,
          );

          // Enrich sources with original filenames before persisting.
          const enrichedSources = await this.fileService.enrichSourcesWithFileNames(
            sources,
          );

          // Stream the enriched sources to the frontend BEFORE we close
          // the connection. The original `sources` event from FastAPI
          // doesn't have fileNames (those live in our DB), so without
          // this the source pills wouldn't appear until the next
          // background refetch — which the user perceived as sources
          // "showing up later". This event is emitted only once per
          // turn, after the answer text is fully streamed.
          if (enrichedSources && enrichedSources.length > 0) {
            res.write(
              `event: sources_final\ndata: ${JSON.stringify({ sources: enrichedSources })}\n\n`,
            );
            if (typeof (res as any).flush === 'function') (res as any).flush();
          }

          // Save assistant message to database
          const assistantMessage = this.messageRepository.create({
            conversation,
            user: conversation.user,
            role: MessageRole.ASSISTANT,
            content: fullAnswer,
            contextFileId: messageDto.contextFileId || null,
            sources: enrichedSources,
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

      response.data.on('error', async (error: any) => {
        this.logger.error(`Stream error: ${error.message}`, error.stack);
        // Stream broke mid-flight — extraction will not complete, so
        // remove the zombie row before it blocks future retries.
        await this.finalizeAttachmentRow(
          newAttachment,
          attachmentFlowUsed,
          extractedContent,
          extractedContentLength,
          chunksCreatedForAttachment,
        ).catch(() => undefined);
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      });

    } catch (error: any) {
      this.logger.error(`AI streaming query failed: ${error.message}`, error.stack);

      // axios.post itself failed (network error, FastAPI down, etc.) —
      // FastAPI never saw the request, so the row we just created is a
      // zombie. Clean it up.
      await this.finalizeAttachmentRow(
        newAttachment,
        null,
        null,
        null,
        null,
      ).catch(() => undefined);

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
