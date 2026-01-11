import { IsString, MaxLength } from 'class-validator';

export class FileItemDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  url: string;
}
