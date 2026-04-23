import { IsOptional, IsUUID } from 'class-validator';

export class LeaveSessionDto {
  @IsOptional()
  @IsUUID('4')
  actingHostId?: string;
}
