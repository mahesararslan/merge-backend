import { MessageRole } from '../../entities/ai-chat-message.entity';
import { AttachmentType } from '../../entities/ai-conversation.entity';

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

export class AttachmentMetadataDto {
  url: string;
  type: AttachmentType;
  originalName: string;
  inVectorDB: boolean;
}

export class ConversationResponseDto {
  id: string;
  title: string;

  summary?: string | null;
  attachment?: AttachmentMetadataDto | null;
  createdAt: Date;
  updatedAt: Date;
  messageCount?: number;
  lastMessage?: MessageResponseDto;
}

export class ConversationWithMessagesDto extends ConversationResponseDto {
  messages: MessageResponseDto[];
}
