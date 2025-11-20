// src/file/dto/upload-file.dto.ts
import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class UploadFileDto {
  @IsOptional()
  @IsUUID('4', { message: 'Folder ID must be a valid UUID' })
  folderId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Room ID must be a valid UUID' })
  roomId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Description cannot exceed 500 characters' })
  description?: string;
}