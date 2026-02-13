import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { AiChatMessage } from '../entities/ai-chat-message.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { RoomMember } from '../entities/room-member.entity';
import { QueryAiDto } from './dto/query-ai.dto';
import { QueryAiResponseDto, SourceChunkDto } from './dto/query-ai-response.dto';
import { GetChatHistoryDto } from './dto/get-chat-history.dto';

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);
  private readonly aiServiceUrl: string;

  constructor(
    @InjectRepository(AiChatMessage)
    private aiChatMessageRepository: Repository<AiChatMessage>,
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
   * Query the AI assistant with a question
   */
  async queryAi(queryDto: QueryAiDto, userId: string): Promise<QueryAiResponseDto> {
    // Validate user exists
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Validate that user has access to all requested rooms
    await this.validateUserRoomAccess(userId, queryDto.roomIds);

    try {
      this.logger.log(`Querying AI for user ${userId} with query: ${queryDto.query.substring(0, 50)}...`);

      // Call FastAPI service
      const response = await axios.post(
        `${this.aiServiceUrl}/query`,
        {
          query: queryDto.query,
          user_id: userId,
          room_ids: queryDto.roomIds,
          context_file_id: queryDto.contextFileId || null,
          top_k: queryDto.topK || 5,
        },
        {
          timeout: 30000, // 30 second timeout
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      const aiResponse = response.data;

      // Save chat history
      const chatMessage = await this.saveChatHistory(
        user,
        queryDto.query,
        aiResponse.answer,
        queryDto.roomIds,
        queryDto.contextFileId || null,
        aiResponse.sources,
        aiResponse.chunks_retrieved,
        aiResponse.processing_time_ms,
      );

      // Format and return response
      return {
        answer: aiResponse.answer,
        sources: aiResponse.sources.map((source: any) => ({
          fileId: source.file_id,
          chunkIndex: source.chunk_index,
          content: source.content,
          relevanceScore: source.relevance_score,
          sectionTitle: source.section_title,
        })),
        query: aiResponse.query,
        processingTimeMs: aiResponse.processing_time_ms,
        chunksRetrieved: aiResponse.chunks_retrieved,
        chatMessageId: chatMessage.id,
      };
    } catch (error) {
      this.logger.error(`AI query failed: ${error.message}`, error.stack);

      if (error.response) {
        // FastAPI returned an error
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

      // Check if user is a member of the room
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
   * Save chat history to database
   */
  private async saveChatHistory(
    user: User,
    query: string,
    answer: string,
    roomIds: string[],
    contextFileId: string | null,
    sources: any[],
    chunksRetrieved: number,
    processingTimeMs: number,
  ): Promise<AiChatMessage> {
    const chatMessage = this.aiChatMessageRepository.create({
      user,
      query,
      answer,
      roomIds,
      contextFileId,
      sources,
      chunksRetrieved,
      processingTimeMs,
    });

    return await this.aiChatMessageRepository.save(chatMessage);
  }

  /**
   * Get user's chat history with pagination
   */
  async getChatHistory(
    userId: string,
    queryDto: GetChatHistoryDto,
  ): Promise<{
    messages: AiChatMessage[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const { page = 1, limit = 20 } = queryDto;
    const skip = (page - 1) * limit;

    const [messages, total] = await this.aiChatMessageRepository.findAndCount({
      where: { user: { id: userId } },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      messages,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get a specific chat message
   */
  async getChatMessage(
    messageId: string,
    userId: string,
  ): Promise<AiChatMessage> {
    const message = await this.aiChatMessageRepository.findOne({
      where: { id: messageId, user: { id: userId } },
      relations: ['user'],
    });

    if (!message) {
      throw new NotFoundException('Chat message not found');
    }

    return message;
  }

  /**
   * Delete a chat message
   */
  async deleteChatMessage(
    messageId: string,
    userId: string,
  ): Promise<void> {
    const message = await this.getChatMessage(messageId, userId);
    await this.aiChatMessageRepository.remove(message);
  }
}
