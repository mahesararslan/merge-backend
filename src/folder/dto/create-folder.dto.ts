import { IsString, IsNotEmpty, MaxLength, MinLength, IsOptional, IsUUID, IsEnum } from 'class-validator';
import { FolderType } from '../../entities/folder.entity';

export class CreateFolderDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1, { message: 'Folder name must be at least 1 character long' })
  @MaxLength(50, { message: 'Folder name cannot exceed 50 characters' })
  name: string;

  @IsEnum(FolderType, { message: 'Type must be either "notes" or "room"' })
  type: FolderType;

  @IsOptional()
  @IsUUID('4', { message: 'Room ID must be a valid UUID' })
  roomId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Parent folder ID must be a valid UUID' })
  parentFolderId?: string;
}