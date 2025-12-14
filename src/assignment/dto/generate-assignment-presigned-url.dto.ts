import { IsString, IsNotEmpty, IsNumber, IsUUID, Min, Max } from 'class-validator';

export class GenerateAssignmentPresignedUrlDto {
  @IsString()
  @IsNotEmpty()
  originalName: string;

  @IsString()
  @IsNotEmpty()
  contentType: string;

  @IsNumber()
  @Min(1)
  @Max(50 * 1024 * 1024) // 50MB max
  size: number;

  @IsUUID('4')
  roomId: string;
}
