// src/file/dto/update-file.dto.ts
import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class UpdateFileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'File name cannot exceed 255 characters' })
  originalName?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Folder ID must be a valid UUID' })
  folderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Description cannot exceed 500 characters' })
  description?: string;
}