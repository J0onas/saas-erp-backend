import { Controller, Get, Query, Res, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ReportsService } from './reports.service';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { Response } from 'express';

@Controller('reports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('GERENTE', 'SUPERADMIN')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  // GET /api/v1/reports/sire?month=3&year=2026
  // Descarga el CSV formato SUNAT SIRE
  @Get('sire')
  async downloadSire(
    @Req() req: any,
    @Res() res: Response,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    const m = parseInt(month || String(new Date().getMonth() + 1));
    const y = parseInt(year || String(new Date().getFullYear()));

    const csv = await this.reportsService.exportSireCSV(
      req.user.tenantId,
      m,
      y,
    );

    const filename = `SIRE_${y}${String(m).padStart(2, '0')}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    // BOM UTF-8 para que Excel lo abra correctamente
    res.send('\uFEFF' + csv);
  }

  // GET /api/v1/reports/ventas?desde=2026-01-01&hasta=2026-03-31&branchId=...
  // Descarga reporte de ventas en CSV
  @Get('ventas')
  async downloadVentas(
    @Req() req: any,
    @Res() res: Response,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('branchId') branchId?: string,
  ) {
    const fechaDesde =
      desde ||
      new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        .toISOString()
        .split('T')[0];
    const fechaHasta = hasta || new Date().toISOString().split('T')[0];

    const csv = await this.reportsService.exportVentasCSV(
      req.user.tenantId,
      fechaDesde,
      fechaHasta,
      branchId,
    );

    const filename = `Ventas_${fechaDesde}_${fechaHasta}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv);
  }

  // GET /api/v1/reports/monthly?year=2026
  // Resumen mensual en JSON
  @Get('monthly')
  async getMonthlySummary(@Req() req: any, @Query('year') year: string) {
    const y = parseInt(year || String(new Date().getFullYear()));
    return await this.reportsService.getMonthlySummary(req.user.tenantId, y);
  }
}
