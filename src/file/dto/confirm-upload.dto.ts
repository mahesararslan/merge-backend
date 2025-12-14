import { IsString, IsNotEmpty, IsNumber, IsOptional, IsUUID, IsUrl } from 'class-validator';

export class ConfirmUploadDto {
  @IsString()
  @IsNotEmpty()
  fileKey: string;

  @IsUrl()
  @IsNotEmpty()
  fileUrl: string;

  @IsString()
  @IsNotEmpty()
  originalName: string;

  @IsString()
  @IsNotEmpty()
  contentType: string;

  @IsNumber()
  size: number;

  @IsOptional()
  @IsUUID('4')
  roomId?: string;

  @IsOptional()
  @IsUUID('4')
  folderId?: string;
}
