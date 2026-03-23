// ── branches.controller.ts ───────────────────────────────────────────────────
import {
    Controller, Get, Post, Patch,
    Body, Param, UseGuards, Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { BranchesService } from './branches.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('branches')
@UseGuards(AuthGuard('jwt'))
export class BranchesController {
    constructor(private readonly branchesService: BranchesService) {}

    // GET /api/v1/branches
    @Get()
    async getAll(@Req() req: any) {
        return await this.branchesService.findAll(req.user.tenantId);
    }

    // POST /api/v1/branches
    @Post()
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async create(
        @Body() body: { name: string; address?: string; phone?: string },
        @Req() req: any
    ) {
        return await this.branchesService.create(req.user.tenantId, body);
    }

    // PATCH /api/v1/branches/:id
    @Patch(':id')
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async update(
        @Param('id') id: string,
        @Body() body: { name?: string; address?: string; phone?: string; is_active?: boolean },
        @Req() req: any
    ) {
        return await this.branchesService.update(req.user.tenantId, id, body);
    }

    // GET /api/v1/branches/:id/stock
    @Get(':id/stock')
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async getStock(@Param('id') id: string, @Req() req: any) {
        return await this.branchesService.getBranchStock(req.user.tenantId, id);
    }

    // GET /api/v1/branches/:id/stats
    @Get(':id/stats')
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async getStats(@Param('id') id: string, @Req() req: any) {
        return await this.branchesService.getBranchStats(req.user.tenantId, id);
    }

    // POST /api/v1/branches/transfer
    @Post('transfer')
    @UseGuards(RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    async transfer(
        @Body() body: {
            fromBranchId: string;
            toBranchId: string;
            productId: string;
            quantity: number;
        },
        @Req() req: any
    ) {
        return await this.branchesService.transferStock(req.user.tenantId, body);
    }
}
