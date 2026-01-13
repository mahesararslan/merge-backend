import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeneralChatMessage } from '../entities/general-chat-message.entity';
import { User } from '../entities/user.entity';
import { Room } from '../entities/room.entity';
import { CreateGeneralChatMessageDto } from './dto/create-general-chat-message.dto';
import { UpdateGeneralChatMessageDto } from './dto/update-general-chat-message.dto';
import { QueryGeneralChatMessagesDto } from './dto/query-general-chat-messages.dto';

@Injectable()
export class GeneralChatService {
  // 3 hours in milliseconds for delete for everyone time limit
  private readonly DELETE_FOR_EVERYONE_TIME_LIMIT = 3 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(GeneralChatMessage)
    private messageRepository: Repository<GeneralChatMessage>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Room)
    private roomRepository: Repository<Room>,
  ) {}

  async create(createMessageDto: CreateGeneralChatMessageDto, authorId: string) {
    const [author, room] = await Promise.all([
      this.userRepository.findOne({ where: { id: authorId } }),
      this.roomRepository.findOne({ where: { id: createMessageDto.roomId } }),
    ]);

    if (!author) {
      throw new NotFoundException('User not found');
    }

    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const message = new GeneralChatMessage();
    const now = new Date(); // @ts-ignore
    message.content = createMessageDto.content; // @ts-ignore
    message.attachmentURL = createMessageDto.attachmentURL ?? null; // @ts-ignore
    message.replyToId = createMessageDto.replyToId ?? null;
    message.deletedForUserIds = [];
    message.author = author;
    message.room = room;
    message.createdAt = now;
    message.updatedAt = now;

    const saved = await this.messageRepository.save(message);
    return this.formatMessageResponse(saved, authorId);
  }

  async findAll(queryDto: QueryGeneralChatMessagesDto, userId: string) {
    const { roomId, page = 1, limit = 50, sortOrder = 'DESC', beforeMessageId, afterMessageId } = queryDto;

    // Verify room exists
    const room = await this.roomRepository.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException('Room not found');
    }

    const skip = (page - 1) * limit;

    let queryBuilder = this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.author', 'author')
      .leftJoinAndSelect('message.room', 'room')
      .where('message.room.id = :roomId', { roomId });

    // Handle cursor-based pagination
    if (beforeMessageId) {
      const beforeMessage = await this.messageRepository.findOne({ where: { id: beforeMessageId } });
      if (beforeMessage) {
        queryBuilder.andWhere('message.createdAt < :beforeDate', { beforeDate: beforeMessage.createdAt });
      }
    }

    if (afterMessageId) {
      const afterMessage = await this.messageRepository.findOne({ where: { id: afterMessageId } });
      if (afterMessage) {
        queryBuilder.andWhere('message.createdAt > :afterDate', { afterDate: afterMessage.createdAt });
      }
    }

    const [messages, total] = await queryBuilder
      .orderBy('message.createdAt', sortOrder)
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    // Filter out messages deleted for this user and format response
    const filteredMessages = messages
      .filter(msg => !msg.deletedForUserIds?.includes(userId))
      .map(msg => this.formatMessageResponse(msg, userId));

    return {
      messages: filteredMessages,
      total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      room: {
        id: room.id,
        title: room.title,
      },
    };
  }

  async findOne(id: string, roomId: string, userId: string) {
    const message = await this.messageRepository.findOne({
      where: { id, room: { id: roomId } },
      relations: ['author', 'room'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Check if deleted for this user
    if (message.deletedForUserIds?.includes(userId)) {
      throw new NotFoundException('Message not found');
    }

    return this.formatMessageResponse(message, userId);
  }

  async update(id: string, roomId: string, updateMessageDto: UpdateGeneralChatMessageDto, userId: string) {
    const message = await this.messageRepository.findOne({
      where: { id, room: { id: roomId } },
      relations: ['author', 'room'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Only author can edit
    if (message.author.id !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    // Cannot edit if deleted for everyone
    if (message.isDeletedForEveryone) {
      throw new BadRequestException('Cannot edit a deleted message');
    }

    if (updateMessageDto.content !== undefined) {
      message.content = updateMessageDto.content;
      message.isEdited = true;
    }

    if (updateMessageDto.attachmentURL !== undefined) {
      message.attachmentURL = updateMessageDto.attachmentURL;
    }

    message.updatedAt = new Date();

    const updated = await this.messageRepository.save(message);
    return this.formatMessageResponse(updated, userId);
  }

  async deleteForMe(id: string, roomId: string, userId: string) {
    const message = await this.messageRepository.findOne({
      where: { id, room: { id: roomId } },
      relations: ['author', 'room'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Add user to deletedForUserIds if not already there
    const deletedForUserIds = message.deletedForUserIds || [];
    if (!deletedForUserIds.includes(userId)) {
      deletedForUserIds.push(userId);
      message.deletedForUserIds = deletedForUserIds;
      await this.messageRepository.save(message);
    }

    return { message: 'Message deleted for you' };
  }

  async deleteForEveryone(id: string, roomId: string, userId: string) {
    const message = await this.messageRepository.findOne({
      where: { id, room: { id: roomId } },
      relations: ['author', 'room'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Only author can delete for everyone
    if (message.author.id !== userId) {
      throw new ForbiddenException('You can only delete your own messages for everyone');
    }

    // Check time limit (3 hours)
    const timeSinceCreation = Date.now() - new Date(message.createdAt).getTime();
    if (timeSinceCreation > this.DELETE_FOR_EVERYONE_TIME_LIMIT) {
      throw new BadRequestException('Cannot delete for everyone after 3 hours. You can still delete for yourself.');
    }

    // Already deleted for everyone
    if (message.isDeletedForEveryone) {
      throw new BadRequestException('Message already deleted for everyone');
    }

    message.isDeletedForEveryone = true;
    message.deletedForEveryoneAt = new Date();
    await this.messageRepository.save(message);

    return { message: 'Message deleted for everyone' };
  }

  private formatMessageResponse(message: GeneralChatMessage, currentUserId: string) {
    // If deleted for everyone, show placeholder content
    const content = message.isDeletedForEveryone 
      ? 'This message was deleted' 
      : message.content;

    return {
      id: message.id,
      content,
      attachmentURL: message.isDeletedForEveryone ? null : message.attachmentURL,
      replyToId: message.replyToId,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
      isEdited: message.isEdited,
      isDeletedForEveryone: message.isDeletedForEveryone,
      isMine: message.author?.id === currentUserId,
      author: message.author ? {
        id: message.author.id,
        firstName: message.author.firstName,
        lastName: message.author.lastName,
        email: message.author.email,
        image: message.author.image,
      } : null,
      room: message.room ? {
        id: message.room.id,
        title: message.room.title,
      } : null,
    };
  }
}
