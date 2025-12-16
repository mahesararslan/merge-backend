import { IsArray, IsUUID, ArrayNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class BulkDeleteContentDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @Type(() => String)
  fileIds: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  @Type(() => String)
  folderIds: string[];
}
