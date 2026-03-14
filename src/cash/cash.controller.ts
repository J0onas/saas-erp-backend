import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CashService } from './cash.service';
import { SubscriptionGuard } from '../auth/subscription.guard'; 

// --- FIX BUG: Solo 'cash', el api/v1 ya lo pone el main.ts automáticamente ---
@Controller('cash')
@UseGuards(AuthGuard('jwt'), SubscriptionGuard)
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Get('status')
  async getStatus(@Req() req: any) {
    return await this.cashService.getActiveSession(req.user.tenantId);
  }

  @Post('open')
  async open(@Body() body: { initialAmount: number }, @Req() req: any) {
    return await this.cashService.openBox(req.user.tenantId, req.user.email, body.initialAmount);
  }

  @Post('close')
  async close(
    @Body() body: { finalAmountCash: number; notes?: string }, 
    @Req() req: any
  ) {
    return await this.cashService.closeBox(req.user.tenantId, body.finalAmountCash, body.notes);
  }
}