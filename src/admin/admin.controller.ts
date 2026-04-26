import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AdminService } from './admin.service';
import { UserRole } from '../entities/user.entity';
import { PlanTier } from '../entities/subscription-plan.entity';

@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ─── Overview / Dashboard ─────────────────────────────────────────────────
  @Get('overview')
  getOverview() {
    return this.adminService.getOverview();
  }

  // ─── Users ────────────────────────────────────────────────────────────────
  @Get('users')
  listUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('role') role?: UserRole,
    @Query('tier') tier?: PlanTier,
    @Query('search') search?: string,
  ) {
    return this.adminService.listUsers({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      role, tier, search,
    });
  }

  @Get('users/:id')
  getUserDetail(@Param('id') id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Patch('users/:id/role')
  @UsePipes(new ValidationPipe({ transform: true }))
  updateUserRole(@Param('id') id: string, @Body() body: { role: UserRole }) {
    return this.adminService.updateUserRole(id, body.role);
  }

  @Patch('users/:id/suspend')
  suspendUser(@Param('id') id: string, @Body() body: { suspend: boolean; reason?: string }) {
    return this.adminService.setUserSuspension(id, body.suspend, body.reason);
  }

  // ─── Billing ──────────────────────────────────────────────────────────────
  @Get('billing/payments')
  listPayments(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('planTier') planTier?: PlanTier,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.adminService.listPayments({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      status, planTier, from, to,
    });
  }

  @Get('billing/revenue')
  getRevenue(@Query('days') days?: string) {
    return this.adminService.getRevenueSeries(days ? Number(days) : 30);
  }

  @Get('billing/subscriptions')
  getSubscriptionsSummary() {
    return this.adminService.getSubscriptionsSummary();
  }

  // ─── Rewards content ──────────────────────────────────────────────────────
  @Get('rewards/challenges')
  listChallenges() { return this.adminService.listChallenges(); }

  @Post('rewards/challenges')
  createChallenge(@Body() body: any) { return this.adminService.createChallenge(body); }

  @Patch('rewards/challenges/:id')
  updateChallenge(@Param('id') id: string, @Body() body: any) {
    return this.adminService.updateChallenge(id, body);
  }

  @Delete('rewards/challenges/:id')
  deleteChallenge(@Param('id') id: string) { return this.adminService.deleteChallenge(id); }

  @Get('rewards/badges')
  listBadges() { return this.adminService.listBadges(); }

  @Patch('rewards/badges/:id')
  updateBadge(@Param('id') id: string, @Body() body: any) { return this.adminService.updateBadge(id, body); }

  @Get('rewards/awarded')
  listAwarded(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.listAwardedBadges({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ─── Rooms ────────────────────────────────────────────────────────────────
  @Get('rooms')
  listRooms(@Query('page') page?: string, @Query('limit') limit?: string, @Query('search') search?: string) {
    return this.adminService.listRooms({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      search,
    });
  }

  @Delete('rooms/:id')
  deleteRoom(@Param('id') id: string) { return this.adminService.deleteRoom(id); }

  // ─── Live sessions ────────────────────────────────────────────────────────
  @Get('sessions/live')
  listLiveSessions() { return this.adminService.listLiveSessions(); }

  @Get('sessions/history')
  listSessionHistory(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.adminService.listSessionHistory({
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ─── Broadcast ────────────────────────────────────────────────────────────
  @Post('broadcast')
  broadcast(@Body() body: { message: string; audience?: 'all' | 'paid' | 'free' }) {
    return this.adminService.broadcast(body.message, body.audience ?? 'all');
  }
}
