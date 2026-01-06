import { IsUUID, IsIn } from 'class-validator';

export class ReviewJoinRequestDto {
  @IsUUID('4')
  requestId: string;

  @IsIn(['accepted', 'rejected'])
  action: 'accepted' | 'rejected';
}
