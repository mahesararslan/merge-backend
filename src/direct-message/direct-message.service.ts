import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from '../entities/message.entity';
import { User } from '../entities/user.entity';
import { CreateMessageDto } from './dto/create-message.dto';
import { UpdateMessageDto } from './dto/update-message.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';

@Injectable()
export class DirectMessageService {
  // 3 hours in milliseconds for delete for everyone time limit
  private readonly DELETE_FOR_EVERYONE_TIME_LIMIT = 3 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(Message)
    private messageRepository: Repository<Message>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async create(createMessageDto: CreateMessageDto, senderId: string) {
    const [sender, recipient] = await Promise.all([
      this.userRepository.findOne({ where: { id: senderId } }),
      this.userRepository.findOne({ where: { id: createMessageDto.recipientId } }),
    ]);

    if (!sender) {
      throw new NotFoundException('Sender not found');
    }

    if (!recipient) {
      throw new NotFoundException('Recipient not found');
    }

    if (senderId === createMessageDto.recipientId) {
      throw new BadRequestException('Cannot send message to yourself');
    }

    const message = new Message(); // @ts-ignore
    message.content = createMessageDto.content; // @ts-ignore
    message.attachmentURL = createMessageDto.attachmentURL ?? null; // @ts-ignore
    message.replyToId = createMessageDto.replyToId ?? null;
    message.deletedForUserIds = [];
    message.sender = sender;
    message.recipient = recipient;

    const saved = await this.messageRepository.save(message);
    return this.formatMessageResponse(saved, senderId);
  }

  async findConversation(queryDto: QueryMessagesDto, userId: string) {
    const { participantId, page = 1, limit = 50, sortOrder = 'DESC', beforeMessageId, afterMessageId } = queryDto;

    // Verify participant exists
    const participant = await this.userRepository.findOne({ where: { id: participantId } });
    if (!participant) {
      throw new NotFoundException('Participant not found');
    }

    const skip = (page - 1) * limit;

    let queryBuilder = this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.recipient', 'recipient')
      .where(
        '((message.sender.id = :userId AND message.recipient.id = :participantId) OR ' +
        '(message.sender.id = :participantId AND message.recipient.id = :userId))',
        { userId, participantId }
      );

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
      participant: {
        id: participant.id,
        firstName: participant.firstName,
        lastName: participant.lastName,
        email: participant.email,
        image: participant.image,
      },
    };
  }

  async findOne(id: string, userId: string) {
    const message = await this.messageRepository.findOne({
      where: { id },
      relations: ['sender', 'recipient'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Check if user is part of the conversation
    if (message.sender.id !== userId && message.recipient.id !== userId) {
      throw new ForbiddenException('You do not have access to this message');
    }

    // Check if deleted for this user
    if (message.deletedForUserIds?.includes(userId)) {
      throw new NotFoundException('Message not found');
    }

    return this.formatMessageResponse(message, userId);
  }

  async update(id: string, updateMessageDto: UpdateMessageDto, userId: string) {
    const message = await this.messageRepository.findOne({
      where: { id },
      relations: ['sender', 'recipient'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Only sender can edit
    if (message.sender.id !== userId) {
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

    const updated = await this.messageRepository.save(message);
    return this.formatMessageResponse(updated, userId);
  }

  async deleteForMe(id: string, userId: string) {
    const message = await this.messageRepository.findOne({
      where: { id },
      relations: ['sender', 'recipient'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Check if user is part of the conversation
    if (message.sender.id !== userId && message.recipient.id !== userId) {
      throw new ForbiddenException('You do not have access to this message');
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

  async deleteForEveryone(id: string, userId: string) {
    const message = await this.messageRepository.findOne({
      where: { id },
      relations: ['sender', 'recipient'],
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Only sender can delete for everyone
    if (message.sender.id !== userId) {
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

  async getConversationList(userId: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    // Get distinct conversations with latest message
    const conversations = await this.messageRepository
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.sender', 'sender')
      .leftJoinAndSelect('message.recipient', 'recipient')
      .where('message.sender.id = :userId OR message.recipient.id = :userId', { userId })
      .orderBy('message.createdAt', 'DESC')
      .getMany();

    // Group by conversation partner and get latest message
    const conversationMap = new Map<string, any>();
    
    for (const msg of conversations) {
      // Skip messages deleted for this user
      if (msg.deletedForUserIds?.includes(userId)) continue;

      const partnerId = msg.sender.id === userId ? msg.recipient.id : msg.sender.id;
      const partner = msg.sender.id === userId ? msg.recipient : msg.sender;

      if (!conversationMap.has(partnerId)) {
        conversationMap.set(partnerId, {
          participant: {
            id: partner.id,
            firstName: partner.firstName,
            lastName: partner.lastName,
            email: partner.email,
            image: partner.image,
          },
          lastMessage: this.formatMessageResponse(msg, userId),
        });
      }
    }

    const allConversations = Array.from(conversationMap.values());
    const paginatedConversations = allConversations.slice(skip, skip + limit);

    return {
      conversations: paginatedConversations,
      total: allConversations.length,
      totalPages: Math.ceil(allConversations.length / limit),
      currentPage: page,
    };
  }

  private formatMessageResponse(message: Message, currentUserId: string) {
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
      isMine: message.sender?.id === currentUserId,
      sender: message.sender ? {
        id: message.sender.id,
        firstName: message.sender.firstName,
        lastName: message.sender.lastName,
        email: message.sender.email,
        image: message.sender.image,
      } : null,
      recipient: message.recipient ? {
        id: message.recipient.id,
        firstName: message.recipient.firstName,
        lastName: message.recipient.lastName,
        email: message.recipient.email,
        image: message.recipient.image,
      } : null,
    };
  }
}
