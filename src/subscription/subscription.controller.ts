import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  Request,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { SubscriptionService } from './subscription.service';

@Controller('subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('plans')
  getPlans(@Request() req) {
    return this.subscriptionService.getPlans(req.user?.role);
  }

  @Get('my')
  getMySubscription(@Request() req) {
    return this.subscriptionService.getUserSubscription(req.user.id);
  }

  @Post('checkout')
  createCheckout(@Request() req, @Body() body: { planId: string }) {
    return this.subscriptionService.createCheckoutSession(req.user.id, body.planId);
  }

  @Delete('my')
  cancelSubscription(@Request() req) {
    return this.subscriptionService.cancelUserSubscription(req.user.id);
  }

  @Post('my/resume')
  resumeSubscription(@Request() req) {
    return this.subscriptionService.resumeUserSubscription(req.user.id);
  }

  @Get('payments')
  getPayments(@Request() req, @Query('page') page = '1', @Query('limit') limit = '10') {
    return this.subscriptionService.getPaymentHistory(req.user.id, +page, +limit);
  }

  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Req() req: any, @Headers('x-signature') signature: string) {
    return this.subscriptionService.handleWebhook(req.rawBody ?? req.body, signature);
  }
}
