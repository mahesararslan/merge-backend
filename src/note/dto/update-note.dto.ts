import { IsString, IsOptional, MaxLength, MinLength, IsUUID } from 'class-validator';

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Title must be at least 1 character long' })
  @MaxLength(100, { message: 'Title cannot exceed 100 characters' })
  title?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Content cannot be empty' })
  content?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Folder ID must be a valid UUID' })
  folderId?: string;
}