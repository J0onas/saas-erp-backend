import {
    Controller, Post, Body, UseGuards, Req,
    Get, Param, HttpException, HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { SubscriptionGuard } from '../auth/subscription.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreditNoteService } from './credit-note.service';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';

@Controller('invoices')
export class InvoiceController {
    constructor(
        private readonly invoiceService: InvoiceService,
        private readonly creditNoteService: CreditNoteService,
    ) {}

    // ── EMITIR COMPROBANTE ────────────────────────────────────────────────────
    @UseGuards(AuthGuard('jwt'), SubscriptionGuard, RolesGuard)
    @Roles('CAJERO', 'GERENTE', 'SUPERADMIN')
    @Post('emit')
    async emitInvoice(@Body() dto: CreateInvoiceDto, @Req() req: any) {
        return await this.invoiceService.processNewInvoice(dto, req.user.tenantId);
    }

    // ── HISTORIAL ─────────────────────────────────────────────────────────────
    @UseGuards(AuthGuard('jwt'))
    @Get('history')
    async getHistory(@Req() req: any) {
        return await this.invoiceService.getInvoicesHistory(req.user.tenantId);
    }

    // ── PDF ───────────────────────────────────────────────────────────────────
    @UseGuards(AuthGuard('jwt'))
    @Get(':id/pdf')
    async getPdf(@Param('id') invoiceId: string, @Req() req: any) {
        return await this.invoiceService.getInvoicePdf(invoiceId, req.user.tenantId);
    }

    // ── ANULAR / NOTA DE CRÉDITO (solo GERENTE) ───────────────────────────────
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    @Post(':id/cancel')
    async cancelInvoice(
        @Param('id') invoiceId: string,
        @Body() body: { reason: string },
        @Req() req: any,
    ) {
        return await this.creditNoteService.createCreditNote(
            invoiceId,
            req.user.tenantId,
            body.reason
        );
    }

    // ── LISTAR NOTAS DE CRÉDITO ───────────────────────────────────────────────
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    @Get('credit-notes')
    async getCreditNotes(@Req() req: any) {
        return await this.creditNoteService.getCreditNotes(req.user.tenantId);
    }

    // ── REPORTES DASHBOARD (solo GERENTE) ─────────────────────────────────────
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    @Get('reports/dashboard')
    async getDashboardReports(@Req() req: any) {
        return await this.invoiceService.getDashboardMetrics(req.user.tenantId);
    }

    // ── REPORTE SIRE ──────────────────────────────────────────────────────────
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('GERENTE', 'SUPERADMIN')
    @Get('reports/sire/:year/:month')
    async exportSireReport(
        @Req() req: any,
        @Param('year') year: string,
        @Param('month') month: string,
    ) {
        return await this.invoiceService.getAccountingReport(
            req.user.tenantId,
            parseInt(month, 10),
            parseInt(year, 10),
        );
    }

    // ── MERCADO PAGO ──────────────────────────────────────────────────────────
    @UseGuards(AuthGuard('jwt'))
    @Post('checkout')
    async createCheckout(
        @Req() req: any,
        @Body() body: { planName: string; precio: number },
    ) {
        const client = new MercadoPagoConfig({
            accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN!,
        });
        const preference = new Preference(client);
        try {
            const result = await preference.create({
                body: {
                    items: [{
                        id: `plan_${body.planName.toLowerCase()}`,
                        title: `Plan ${body.planName} - SaaS POS`,
                        description: 'Suscripción facturación electrónica',
                        quantity: 1,
                        unit_price: Number(body.precio),
                        currency_id: 'PEN',
                    }],
                    back_urls: {
                        success: 'https://google.com',
                        failure: 'https://google.com',
                        pending: 'https://google.com',
                    },
                    external_reference: req.user.tenantId,
                },
            });
            return { success: true, url: result.init_point };
        } catch {
            throw new HttpException(
                'Error al conectar con la pasarela de pagos',
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Post('webhook')
    async handleWebhook(@Body() body: any) {
        if (body.type === 'payment' && body.data?.id) {
            try {
                const client = new MercadoPagoConfig({
                    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN!,
                });
                const payment = new Payment(client);
                const info = await payment.get({ id: body.data.id });
                if (info.status === 'approved' && info.external_reference) {
                    await this.invoiceService.activateSubscription(
                        info.external_reference as string
                    );
                }
            } catch (error) {
                console.error('Error webhook MP:', error);
            }
        }
        return { status: 'ok' };
    }
}
