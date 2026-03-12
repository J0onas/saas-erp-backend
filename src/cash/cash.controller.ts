import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CashService } from './cash.service';
import { SubscriptionGuard } from '../auth/subscription.guard'; 
// (Ajusta la ruta según dónde creaste el archivo subscription.guard.ts)

@Controller('api/v1/cash')
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
  // --- NUEVO ENDPOINT: CERRAR CAJA ---
  @Post('close')
  async close(
    @Body() body: { finalAmountCash: number; notes?: string }, 
    @Req() req: any
  ) {
    return await this.cashService.closeBox(req.user.tenantId, body.finalAmountCash, body.notes);
  }
}