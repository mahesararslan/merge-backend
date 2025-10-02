import { IsString, IsOptional, IsBoolean, IsArray, MaxLength, MinLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MinLength(3, { message: 'Room title must be at least 3 characters long' })
  @MaxLength(100, { message: 'Room title cannot exceed 100 characters' })
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'Description cannot exceed 500 characters' })
  description?: string;

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean = true;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tagNames?: string[];
}