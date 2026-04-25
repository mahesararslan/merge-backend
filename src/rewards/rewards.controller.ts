import { Controller, Get, Request } from '@nestjs/common';
import { RewardsService } from './rewards.service';

@Controller('rewards')
export class RewardsController {
  constructor(private readonly rewardsService: RewardsService) {}

  @Get('profile')
  getProfile(@Request() req) {
    return this.rewardsService.getUserRewardsProfile(req.user.id);
  }

  @Get('challenges')
  getChallenges(@Request() req) {
    return this.rewardsService.getUserChallenges(req.user.id);
  }
}
