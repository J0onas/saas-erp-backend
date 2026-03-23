import {
    Controller, Get, Patch, Body,
    Param, Query, UseGuards, Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SUPERADMIN')
export class AdminController {
    constructor(private readonly adminService: AdminService) {}

    // GET /api/v1/admin/metrics — métricas globales del SaaS
    @Get('metrics')
    async getMetrics() {
        return await this.adminService.getGlobalMetrics();
    }

    // GET /api/v1/admin/tenants — listar todos los tenants
    @Get('tenants')
    async getTenants(
        @Query('status') status?: string,
        @Query('search') search?: string,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        return await this.adminService.getAllTenants({
            status,
            search,
            page:  page  ? parseInt(page)  : 1,
            limit: limit ? parseInt(limit) : 20,
        });
    }

    // GET /api/v1/admin/tenants/:id — detalle de un tenant
    @Get('tenants/:id')
    async getTenantDetail(@Param('id') id: string) {
        return await this.adminService.getTenantDetail(id);
    }

    // PATCH /api/v1/admin/tenants/:id/status — activar/suspender
    @Patch('tenants/:id/status')
    async updateStatus(
        @Param('id') id: string,
        @Body() body: {
            status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL';
            extendDays?: number;
        },
    ) {
        return await this.adminService.updateTenantStatus(
            id, body.status, body.extendDays
        );
    }

    // GET /api/v1/admin/audit-logs — logs globales o por tenant
    @Get('audit-logs')
    async getAuditLogs(
        @Query('tenantId') tenantId?: string,
        @Query('limit') limit?: string,
    ) {
        return await this.adminService.getAuditLogs(
            tenantId,
            limit ? parseInt(limit) : 50
        );
    }
}
