// src/file/dto/update-file.dto.ts
import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class UpdateFileDto {
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'File name cannot exceed 255 characters' })
  updatedName?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Folder ID must be a valid UUID' })
  folderId?: string;
}