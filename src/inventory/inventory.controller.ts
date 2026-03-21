import {
    Controller, Post, Get, Body,
    UseGuards, Req, Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InventoryService } from './inventory.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('inventory')
@UseGuards(AuthGuard('jwt'))
export class InventoryController {
    constructor(private readonly inventoryService: InventoryService) {}

    // POST /api/v1/inventory/entry — ingreso de mercancía
    @Post('entry')
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async entry(
        @Body() body: {
            productId: string;
            quantity: number;
            reason?: string;
            supplierName?: string;
            purchaseCost?: number;
        },
        @Req() req: any
    ) {
        return await this.inventoryService.registerEntry(req.user.tenantId, body);
    }

    // POST /api/v1/inventory/adjust — ajuste manual
    @Post('adjust')
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async adjust(
        @Body() body: { productId: string; newStock: number; reason: string },
        @Req() req: any
    ) {
        return await this.inventoryService.registerAdjustment(req.user.tenantId, body);
    }

    // GET /api/v1/inventory/movements — historial
    @Get('movements')
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async movements(@Req() req: any, @Query('productId') productId?: string) {
        return await this.inventoryService.getMovements(req.user.tenantId, productId);
    }

    // GET /api/v1/inventory/low-stock — alertas de stock bajo
    @Get('low-stock')
    async lowStock(@Req() req: any) {
        return await this.inventoryService.getLowStock(req.user.tenantId);
    }
}
