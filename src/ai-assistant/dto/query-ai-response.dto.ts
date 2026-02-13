export class SourceChunkDto {
  fileId: string;
  chunkIndex: number;
  content: string;
  relevanceScore: number;
  sectionTitle?: string;
}

export class QueryAiResponseDto {
  answer: string;
  sources: SourceChunkDto[];
  query: string;
  processingTimeMs: number;
  chunksRetrieved: number;
  chatMessageId: string; // ID of the saved chat message
}
