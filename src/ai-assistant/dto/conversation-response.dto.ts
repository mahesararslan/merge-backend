import { MessageRole } from '../../entities/ai-chat-message.entity';

export class MessageResponseDto {
  id: string;
  role: MessageRole;
  content: string;
  contextFileId?: string | null;
  sources?: any;
  chunksRetrieved?: number | null;
  processingTimeMs?: number | null;
  createdAt: Date;
}

export class ConversationResponseDto {
  id: string;
  title: string;
  roomIds: string[];
  summary?: string | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount?: number;
  lastMessage?: MessageResponseDto;
}

export class ConversationWithMessagesDto extends ConversationResponseDto {
  messages: MessageResponseDto[];
}
