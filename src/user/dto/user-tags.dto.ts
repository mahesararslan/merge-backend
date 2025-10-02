// src/user/dto/user-tags.dto.ts
import { IsArray, IsString, ArrayMinSize, ArrayMaxSize } from 'class-validator';

export class UserTagsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one tag is required' })
  @ArrayMaxSize(10, { message: 'Maximum 10 tags are allowed' })
  @IsString({ each: true })
  tagNames: string[];
}