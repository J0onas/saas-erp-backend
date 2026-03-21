import {
    Controller, Get, Post, Patch, Delete,
    Body, Param, Query,
    UseGuards, Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SuppliersService } from './suppliers.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('suppliers')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('GERENTE', 'SUPERADMIN')
export class SuppliersController {
    constructor(private readonly suppliersService: SuppliersService) {}

    // GET /api/v1/suppliers
    @Get()
    async getAll(@Req() req: any, @Query('active') active?: string) {
        return await this.suppliersService.findAll(
            req.user.tenantId,
            active === 'true'
        );
    }

    // POST /api/v1/suppliers
    @Post()
    async create(
        @Body() body: {
            name: string; ruc?: string; contact_name?: string;
            email?: string; phone?: string; address?: string; notes?: string;
        },
        @Req() req: any
    ) {
        return await this.suppliersService.create(req.user.tenantId, body);
    }

    // PATCH /api/v1/suppliers/:id
    @Patch(':id')
    async update(
        @Param('id') id: string,
        @Body() body: {
            name?: string; ruc?: string; contact_name?: string;
            email?: string; phone?: string; address?: string; notes?: string;
        },
        @Req() req: any
    ) {
        return await this.suppliersService.update(req.user.tenantId, id, body);
    }

    // PATCH /api/v1/suppliers/:id/toggle
    @Patch(':id/toggle')
    async toggle(
        @Param('id') id: string,
        @Body() body: { active: boolean },
        @Req() req: any
    ) {
        return await this.suppliersService.toggleActive(
            req.user.tenantId, id, body.active
        );
    }

    // GET /api/v1/suppliers/:id/history
    @Get(':id/history')
    async history(@Param('id') id: string, @Req() req: any) {
        return await this.suppliersService.getPurchaseHistory(
            req.user.tenantId, id
        );
    }
}
