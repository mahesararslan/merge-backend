import { IsEnum } from 'class-validator';
import { RoomMemberRole } from 'src/entities/room-member.entity';

export class UpdateMemberRoleDto {
  @IsEnum(RoomMemberRole)
  role: RoomMemberRole;
}
