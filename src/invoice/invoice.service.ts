import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { SunatXmlBuilder } from './utils/SunatXmlBuilder';
import { DataSource } from 'typeorm';

@Injectable()
export class InvoiceService {
    private readonly logger = new Logger(InvoiceService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly httpService: HttpService // <-- INYECTAMOS AXIOS
    ) {}

    async processNewInvoice(invoiceData: CreateInvoiceDto, tenantId: string) {
        this.logger.log(`Procesando factura ${invoiceData.serieNumber} para el tenant ${tenantId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let invoiceId: string;

        try {
            // 1. Guardar en BD con RLS de forma segura
            await queryRunner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);

            // Agregamos "RETURNING id" para saber qué UUID le asignó la base de datos
            const insertResult = await queryRunner.query(
                `INSERT INTO invoices (tenant_id, customer_document, total_amount) 
                 VALUES ($1, $2, $3) RETURNING id`,
                [tenantId, invoiceData.customer.documentNumber, invoiceData.totalAmount]
            );

            invoiceId = insertResult[0].id; // Capturamos el ID de la factura recién creada
            await queryRunner.commitTransaction();

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error guardando en BD:', error);
            throw new InternalServerErrorException('No se pudo guardar la factura.');
        } finally {
            await queryRunner.release();
        }

        // 2. Generar el XML UBL 2.1
        const xmlContent = SunatXmlBuilder.generateInvoiceXml(invoiceData as any);
        
        // 3. ENVÍO AL OSE / SUNAT (Simulado)
        this.logger.log('Enviando XML estructurado al OSE...');
        try {
            // En producción, aquí pondrías la URL de tu proveedor OSE y enviarías el 'xmlContent'
            // const oseResponse = await lastValueFrom(
            //     this.httpService.post('https://api.ose-proveedor.pe/v1/comprobantes', { xml: xmlContent }, { headers: { Authorization: 'Bearer OSE_TOKEN' } })
            // );

            // Para esta prueba, haremos una petición real a una API pública de pruebas (httpstat.us) que siempre devuelve 200 OK
            await lastValueFrom(this.httpService.post('https://jsonplaceholder.typicode.com/posts', { data: "test" }));
            this.logger.log('¡Respuesta exitosa del OSE! (CDR Recibido)');

            // 4. ACTUALIZAR LA BASE DE DATOS A 'ACCEPTED'
            // Abrimos una transacción rápida y directa para actualizar solo esta factura
            await this.dataSource.query(
                `UPDATE invoices SET xml_ubl_status = 'ACCEPTED' WHERE id = $1 AND tenant_id = $2`,
                [invoiceId, tenantId]
            );

        } catch (error) {
            this.logger.error('Error comunicándose con el OSE', error);
            // Si el OSE falla (ej. error 500 de Sunat), la factura se queda en estado 'PENDING' en la BD
            throw new InternalServerErrorException('Error al comunicar con SUNAT/OSE.');
        }

        return {
            success: true,
            message: 'Factura emitida, enviada al OSE y registrada como ACCEPTED',
            document: invoiceData.serieNumber,
            dbId: invoiceId,
            xmlPreview: xmlContent 
        };
    }
}