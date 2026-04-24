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
  attachmentOriginalName?: string | null;
  attachmentType?: string | null;
  attachmentFileSize?: number | null;
  attachmentUrl?: string | null;
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
  /** @deprecated use `attachments` — kept populated with the first entry for backwards compat. */
  attachment?: AttachmentMetadataDto | null;
  /** All active attachments on this conversation (cap: 2). */
  attachments?: AttachmentMetadataDto[];
  createdAt: Date;
  updatedAt: Date;
  messageCount?: number;
  lastMessage?: MessageResponseDto;
}

export class ConversationWithMessagesDto extends ConversationResponseDto {
  messages: MessageResponseDto[];
}
