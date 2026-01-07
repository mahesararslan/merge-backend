import { IsString, IsArray, ArrayMinSize, ArrayMaxSize, IsOptional, MaxLength } from 'class-validator';

export class UpdateAttemptDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  fileUrls?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
