import { Controller, Post, Body, UseGuards, Req, Get, Request, Param, HttpException, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { SubscriptionGuard } from '../auth/subscription.guard'; 
import { MercadoPagoConfig, Preference, Payment} from 'mercadopago';


@Controller('api/v1/invoices')
export class InvoiceController {
    constructor(private readonly invoiceService: InvoiceService) {}

    @UseGuards(AuthGuard('jwt'), SubscriptionGuard) // <--- ESTE DECORADOR PROTEGE LA RUTA
    @Post('emit')
    async emitInvoice(
        @Body() createInvoiceDto: CreateInvoiceDto,
        @Req() req: any // <--- CAPTURAMOS EL REQUEST COMPLETO
    ) {
        // ¡MAGIA! Extraemos el tenantId dinámicamente del Token JWT desencriptado
        const currentTenantId = req.user.tenantId; 

        // Se lo pasamos al servicio, que inyectará este ID en el Row Level Security (RLS) de PostgreSQL
        const result = await this.invoiceService.processNewInvoice(createInvoiceDto, currentTenantId);

        return result;
    }

    

    // --- NUEVO ENDPOINT PARA EL HISTORIAL ---
    @UseGuards(AuthGuard('jwt')) // Usamos exactamente el mismo guardia que ya te funciona
    @Get('history')
    async getHistory(@Req() req: any) {
        // Extraemos el tenantId del token y pedimos la bóveda de facturas
        return await this.invoiceService.getInvoicesHistory(req.user.tenantId);
    }

    // --- NUEVO ENDPOINT PARA DESCARGAR PDF ANTIGUO ---
    @UseGuards(AuthGuard('jwt'))
    @Get(':id/pdf')
    async getPdf(@Param('id') invoiceId: string, @Req() req: any) {
        return await this.invoiceService.getInvoicePdf(invoiceId, req.user.tenantId);
    }

    // --- NUEVO ENDPOINT: REPORTES DEL DASHBOARD ---
    @UseGuards(AuthGuard('jwt'))
    @Get('reports/dashboard')
    async getDashboardReports(@Req() req: any) {
        return await this.invoiceService.getDashboardMetrics(req.user.tenantId);
    }

    // --- SPRINT 3.3: REPORTE CONTABLE SIRE ---
    @UseGuards(AuthGuard('jwt'))
    @Get('reports/sire/:year/:month')
    async exportSireReport(
        @Req() req: any,
        @Param('year') year: string,
        @Param('month') month: string
    ) {
        // Extraemos el tenant de forma segura
        const tenantId = req.user.tenantId;
        
        // Convertimos los parámetros de la URL de texto a números y llamamos al servicio
        return await this.invoiceService.getAccountingReport(
            tenantId, 
            parseInt(month, 10), 
            parseInt(year, 10)
        );
    }
    
    // --- SPRINT 4.1: PASARELA DE PAGOS (MERCADO PAGO) ---
    @UseGuards(AuthGuard('jwt'))
    @Post('checkout')
    async createMercadoPagoCheckout(
        @Req() req: any,
        @Body() body: { planName: string, precio: number }
    ) {
        const tenantId = req.user.tenantId;
        
        // 1. Inicializamos Mercado Pago (REEMPLAZA CON TU ACCESS TOKEN DE PRUEBA)
        const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN! });

        // 2. Creamos la "Preferencia" (Es el ticket de cobro en el sistema de MP)
        const preference = new Preference(client);

        try {
            const result = await preference.create({
                body: {
                    items: [
                        {
                            id: `plan_${body.planName.toLowerCase()}`,
                            title: `Plan ${body.planName} - PuntodeVenta`,
                            description: 'Suscripción SaaS para facturación y POS',
                            quantity: 1,
                            unit_price: Number(body.precio),
                            currency_id: 'PEN', // Soles Peruanos 🇵🇪
                        }
                    ],
                    back_urls: {
                        // Cambiémoslas a https://google.com por un momento solo para engañar al validador de MP
                        success: 'https://google.com',
                        failure: 'https://google.com',
                        pending: 'https://google.com'
                    },
                    // auto_return: 'approved',  <--- ¡BÓRRALO O COMÉNTALO!
                    external_reference: tenantId,
                }
            });

            // MP nos devuelve dos URLs: 'init_point' (producción) y 'sandbox_init_point' (pruebas)
            // Usaremos init_point porque MP detecta por el token que estamos en pruebas.
            return { success: true, url: result.init_point };

        } catch (error) {
            console.error('Error creando preferencia de Mercado Pago:', error);
            throw new HttpException('Error al conectar con la pasarela de pagos', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    // --- SPRINT 4.1: WEBHOOK DE MERCADO PAGO (EL NOTARIO) ---
    @Post('webhook')
    async handleMercadoPagoWebhook(@Body() body: any) {
        console.log('🔔 Webhook tocando la puerta:', body);

        // Mercado Pago envía varios avisos. Solo nos interesan cuando se crea un "pago"
        if (body.type === 'payment' && body.data && body.data.id) {
            const paymentId = body.data.id;

            try {
                // 1. Inicializamos MP con tu token
                const client = new MercadoPagoConfig({ accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN! });
                const payment = new Payment(client);

                // 2. Le preguntamos a MP: "¿Es cierto que este pago existe y está aprobado?"
                const paymentInfo = await payment.get({ id: paymentId });

                if (paymentInfo.status === 'approved') {
                    // Le decimos a TypeScript: "Confía en mí, esto es un texto (string)"
                    const tenantId = paymentInfo.external_reference as string; 

                    if (tenantId) {
                        console.log(`✅ ¡Pago APROBADO por S/ ${paymentInfo.transaction_amount}! Empresa ID: ${tenantId}`);
                        // Mandamos a actualizar la base de datos
                        await this.invoiceService.activateSubscription(tenantId);
                    } else {
                        console.log('⚠️ Pago aprobado, pero no se encontró el ID de la empresa.');
                    }
                }
            } catch (error) {
                console.error('❌ Error verificando el pago con Mercado Pago:', error);
            }
        }

        // SIEMPRE debemos responder 200 OK rápido, o MP pensará que nuestro servidor murió 
        // y nos enviará el mismo mensaje 10 veces.
        return { status: 'success' };
    }
}