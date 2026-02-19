import { IsString, IsNotEmpty, IsNumber, IsOptional, IsUUID, Min, Max } from 'class-validator';

export class GeneratePresignedUrlDto {
  @IsString()
  @IsNotEmpty()
  originalName: string;

  @IsString()
  @IsNotEmpty()
  contentType: string;

  @IsNumber()
  @Min(1)
  @Max(15 * 1024 * 1024) // 15 MB max
  size: number;

  @IsOptional()
  @IsUUID('4')
  roomId?: string;

  @IsOptional()
  @IsUUID('4')
  folderId?: string;
}
