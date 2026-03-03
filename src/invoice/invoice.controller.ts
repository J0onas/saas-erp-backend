import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InvoiceService } from './invoice.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';

@Controller('api/v1/invoices')
export class InvoiceController {
    constructor(private readonly invoiceService: InvoiceService) {}

    @UseGuards(AuthGuard('jwt')) // <--- ESTE DECORADOR PROTEGE LA RUTA
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
}