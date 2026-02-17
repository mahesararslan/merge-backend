import { IsString, IsArray, IsOptional, MinLength, MaxLength } from 'class-validator';

export class CreateConversationDto {
  @IsArray()
  @IsString({ each: true })
  roomIds: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title?: string;
}
