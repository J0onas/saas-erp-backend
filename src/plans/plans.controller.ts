// ── plans.controller.ts ──────────────────────────────────────────────────────
import {
    Controller, Get, Patch, Post,
    Body, Param, UseGuards, Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PlansService } from './plans.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('plans')
export class PlansController {
    constructor(private readonly plansService: PlansService) {}

    // GET /api/v1/plans — público (para página de precios)
    @Get()
    async getAll() {
        return await this.plansService.getAll();
    }

    // GET /api/v1/plans/current — plan del tenant autenticado
    @UseGuards(AuthGuard('jwt'))
    @Get('current')
    async getCurrent(@Req() req: any) {
        return await this.plansService.getCurrentPlan(req.user.tenantId);
    }

    // POST /api/v1/plans/assign — asignar plan a tenant (solo SUPERADMIN)
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('SUPERADMIN')
    @Post('assign')
    async assign(@Body() body: { tenantId: string; planId: string }) {
        return await this.plansService.assignPlan(body.tenantId, body.planId);
    }

    // PATCH /api/v1/plans/:id — editar plan (solo SUPERADMIN)
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('SUPERADMIN')
    @Patch(':id')
    async update(
        @Param('id') id: string,
        @Body() body: {
            price_monthly?: number;
            price_yearly?: number;
            max_users?: number;
            max_products?: number;
            max_invoices_mo?: number;
            features?: string[];
        }
    ) {
        return await this.plansService.updatePlan(id, body);
    }
}
