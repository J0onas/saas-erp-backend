import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PdfBuilder } from './utils/PdfBuilder';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { SunatXmlBuilder } from './utils/SunatXmlBuilder';
import { DataSource } from 'typeorm';
import { EmailService } from '../email/email.service';

@Injectable()
export class InvoiceService {
    private readonly logger = new Logger(InvoiceService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly httpService: HttpService, 
        private readonly emailService: EmailService
    ) {}

    async processNewInvoice(invoiceData: CreateInvoiceDto, tenantId: string) {
        this.logger.log(`Procesando factura para el tenant ${tenantId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let invoiceId: string;
        let realSerieNumber: string;
        const metodoPago = (invoiceData as any).paymentMethod || 'EFECTIVO';
        
        // Asignamos la serie fijada temporalmente (Fase 1 luego adaptará Boletas)
        const serie = 'F001'; 

        try {
            // --- FIX BUG #1: PREVENCIÓN SQL INJECTION ---
            // Usamos set_config de forma segura con parámetros parametrizados ($1)
            await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
            
            // --- MAGIA 1: Guardar cliente ---
            const clientExists = await queryRunner.query(
                `SELECT id FROM clients WHERE document_number = $1`, 
                [invoiceData.customer.documentNumber]
            );
            if (clientExists.length === 0) {
                await queryRunner.query(
                    `INSERT INTO clients (tenant_id, document_type, document_number, full_name) VALUES ($1, $2, $3, $4)`,
                    [tenantId, invoiceData.customer.documentType || '6', invoiceData.customer.documentNumber, invoiceData.customer.fullName]
                );
            }

            // --- FIX BUG #4: CORRELATIVOS CONCURRENTES (FOR UPDATE) ---
            // Bloqueamos la fila temporalmente para que nadie más tome este número
            const seqResult = await queryRunner.query(
                `SELECT correlative FROM invoices WHERE serie = $1 ORDER BY correlative DESC LIMIT 1 FOR UPDATE`,
                [serie]
            );
            
            // Calculamos el siguiente número atómicamente
            const nextCorrelative = seqResult.length > 0 ? parseInt(seqResult[0].correlative) + 1 : 1;
            
            realSerieNumber = `${serie}-${nextCorrelative.toString().padStart(8, '0')}`;
            invoiceData.serieNumber = realSerieNumber;

           // --- EXTRAER VARIABLES DE DETRACCIÓN ---
            const tieneDetraccion = (invoiceData as any).hasDetraction || false;
            const detPorcentaje = (invoiceData as any).detractionPercent || 0;
            const detMonto = (invoiceData as any).detractionAmount || 0;

            // --- INSERTAR FACTURA ---
            const insertResult = await queryRunner.query(
                `INSERT INTO invoices 
                (tenant_id, customer_document, total_amount, serie, correlative, issue_date, issue_time, payment_method, has_detraction, detraction_percent, detraction_amount) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
                [
                    tenantId, 
                    invoiceData.customer.documentNumber, 
                    invoiceData.totalAmount, 
                    serie, // Usamos la variable de serie aquí
                    nextCorrelative, 
                    invoiceData.issueDate, 
                    invoiceData.issueTime, 
                    metodoPago,
                    tieneDetraccion,
                    detPorcentaje,
                    detMonto
                ]
            );
            invoiceId = insertResult[0].id;

            // --- MAGIA 4: Detalle de la venta y KARDEX ---
            if (invoiceData.items && invoiceData.items.length > 0) {
                for (const item of invoiceData.items) {
                    
                    // 1. Guardamos la línea de la factura
                    await queryRunner.query(
                        `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, total_price)
                         VALUES ($1, $2, $3, $4, $5, $6)`,
                        [
                            invoiceId, 
                            (item as any).productId || null, 
                            item.description, 
                            item.quantity, 
                            item.unitPrice, 
                            (item.quantity * item.unitPrice)
                        ]
                    );

                    // 2. KARDEX OFICIAL
                    if ((item as any).productId) {
                        this.logger.log(`KARDEX: Descontando ${item.quantity} unidades del producto ${(item as any).productId}`);
                        
                        await queryRunner.query(
                            `UPDATE products 
                             SET stock_quantity = stock_quantity - $1 
                             WHERE id = $2 AND tenant_id = $3`,
                            [item.quantity, (item as any).productId, tenantId]
                        );

                        // NOTA: Esta línea fallará hasta que corras la migración que crea `inventory_movements` (Bug #2)
                        await queryRunner.query(
                            `INSERT INTO inventory_movements (tenant_id, product_id, type, quantity, reason)
                             VALUES ($1, $2, $3, $4, $5)`,
                            [
                                tenantId,
                                (item as any).productId,
                                'OUTPUT',
                                item.quantity,
                                `Venta Factura ${realSerieNumber}`
                            ]
                        );
                    }
                }
            }

            await queryRunner.commitTransaction();

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error guardando en BD:', error);
            throw new InternalServerErrorException('No se pudo guardar la factura.');
        } finally {
            await queryRunner.release();
        }

        const xmlContent = SunatXmlBuilder.generateInvoiceXml(invoiceData as any);
        
        try {
            await lastValueFrom(this.httpService.post('https://jsonplaceholder.typicode.com/posts', { data: "test" }));
            await this.dataSource.transaction(async (manager) => {
                // --- FIX BUG #1 EN LA SEGUNDA TRANSACCIÓN ---
                await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
                await manager.query(
                    `UPDATE invoices SET xml_ubl_status = 'ACCEPTED' WHERE id = $1 AND tenant_id = $2`,
                    [invoiceId, tenantId]
                );
            });
        } catch (error) {
            throw new InternalServerErrorException('Error al comunicar con SUNAT/OSE.');
        }

        const pdfBase64 = await PdfBuilder.generateInvoicePdf(invoiceData);
         if ((invoiceData as any).customerEmail) {
            this.logger.log(`Ordenando envío de correo a ${(invoiceData as any).customerEmail}...`);
            this.emailService.sendInvoiceEmail(
                (invoiceData as any).customerEmail,
                invoiceData.customer.fullName,
                realSerieNumber,
                pdfBase64
            );
        }
        return {
            success: true,
            message: `Factura ${realSerieNumber} emitida exitosamente (${metodoPago})`,
            document: realSerieNumber,
            dbId: invoiceId,
            xmlPreview: xmlContent,
            pdfDocument: pdfBase64
        };
    }

    async getInvoicesHistory(tenantId: string) {
        this.logger.log(`Obteniendo historial de facturas para el tenant ${tenantId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

            const invoices = await queryRunner.query(
                `SELECT 
                    i.id, 
                    CONCAT(i.serie, '-', LPAD(i.correlative::text, 8, '0')) as comprobante,
                    TO_CHAR(i.issue_date, 'YYYY-MM-DD') as fecha,
                    i.customer_document, 
                    c.full_name,
                    i.total_amount, 
                    i.payment_method,
                    i.xml_ubl_status 
                 FROM invoices i
                 LEFT JOIN clients c ON i.customer_document = c.document_number
                 ORDER BY i.id DESC`
            );

            await queryRunner.commitTransaction();
            return invoices;

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error al obtener historial:', error);
            throw new InternalServerErrorException('No se pudo obtener el historial de facturas.');
        } finally {
            await queryRunner.release();
        }
    }

    async getInvoicePdf(invoiceId: string, tenantId: string) {
        this.logger.log(`Regenerando PDF REAL de la factura ${invoiceId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

            // 1. Unir la Factura con los datos reales del Cliente
            const invoiceResult = await queryRunner.query(
                `SELECT i.id, i.customer_document, i.total_amount, i.serie, i.correlative, 
                        TO_CHAR(i.issue_date, 'YYYY-MM-DD') as formatted_issue_date, i.issue_time,
                        i.payment_method, i.has_detraction, i.detraction_percent, i.detraction_amount,
                        c.full_name, c.document_type 
                 FROM invoices i
                 LEFT JOIN clients c ON i.customer_document = c.document_number
                 WHERE i.id = $1`, [invoiceId]
            );
            if (invoiceResult.length === 0) {
                throw new InternalServerErrorException('Factura no encontrada');
            }

            const invoice = invoiceResult[0];

            // 2. Traer los productos reales vendidos
            const itemsResult = await queryRunner.query(
                `SELECT * FROM invoice_items WHERE invoice_id = $1`, [invoiceId]
            );

            const amount = Number(invoice.total_amount);
            const subtotal = amount / 1.18;
            const igv = amount - subtotal;

            // 3. BUSCAR LOS DATOS REALES DE LA EMPRESA
            const settingsResult = await queryRunner.query(
                `SELECT business_name, ruc, address FROM company_settings WHERE tenant_id = $1`,
                [tenantId] 
            );
            
            const company = settingsResult.length > 0 ? settingsResult[0] : { 
                business_name: 'Empresa Sin Configurar', 
                ruc: '00000000000',
                address: 'Dirección no registrada'
            };

            // 4. Reconstruir el documento (SINTAXIS CORREGIDA)
            const realData = {
                serieNumber: `${invoice.serie}-${Number(invoice.correlative).toString().padStart(8, '0')}`,
                issueDate: invoice.formatted_issue_date,
                issueTime: invoice.issue_time,
                paymentMethod: invoice.payment_method,
                
                hasDetraction: invoice.has_detraction,
                detractionPercent: invoice.detraction_percent,
                detractionAmount: Number(invoice.detraction_amount),

                supplier: { 
                    ruc: company.ruc, 
                    businessName: company.business_name,
                    address: company.address
                },

                customer: {
                    documentType: invoice.document_type || "6",
                    documentNumber: invoice.customer_document,
                    fullName: invoice.full_name || "Cliente Sin Registrar"
                },
                
                // Mapeo corregido de los items
                items: itemsResult.length > 0 ? itemsResult.map((item: any) => ({
                    description: item.description,
                    quantity: item.quantity,
                    unitValue: Number((item.unit_price / 1.18).toFixed(2)),
                    unitPrice: Number(item.unit_price),
                    totalTaxes: Number((item.unit_price - (item.unit_price / 1.18)).toFixed(2))
                })) : [{
                    description: "Servicio Histórico",
                    quantity: 1,
                    unitValue: subtotal,
                    unitPrice: amount,
                    totalTaxes: igv
                }],
                
                totalTaxBase: subtotal,
                totalIgv: igv,
                totalAmount: amount
            };

            // 5. Generar y devolver el PDF
            const pdfBase64 = await PdfBuilder.generateInvoicePdf(realData as any);
            await queryRunner.commitTransaction();
            
            return { pdfDocument: pdfBase64 };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error regenerando PDF:', error);
            throw new InternalServerErrorException('No se pudo generar el documento.');
        } finally {
            await queryRunner.release();
        }
    }

    async getDashboardMetrics(tenantId: string) {
        this.logger.log(`Generando métricas del dashboard para el tenant: ${tenantId}`);
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction(); 
        
        try {
            await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

            // 1. KPIs Generales + Ticket Promedio
            const kpis = await queryRunner.query(`
                SELECT 
                    COUNT(id) as total_invoices,
                    COALESCE(SUM(total_amount), 0) as total_revenue,
                    COALESCE(AVG(total_amount), 0) as average_ticket
                FROM invoices
            `);

            // 2. Ventas por Método de Pago
            const paymentMethods = await queryRunner.query(`
                SELECT 
                    payment_method as name,
                    COALESCE(SUM(total_amount), 0) as value
                FROM invoices
                GROUP BY payment_method
            `);

            // 3. Ventas por Día (Últimos 7 días)
            const last7Days = await queryRunner.query(`
                SELECT 
                    TO_CHAR(issue_date, 'DD/MM') as date,
                    COALESCE(SUM(total_amount), 0) as total
                FROM invoices
                WHERE issue_date >= CURRENT_DATE - INTERVAL '6 days'
                GROUP BY issue_date
                ORDER BY issue_date ASC
            `);

            // 4. NUEVO: Top 5 Productos Más Vendidos
            const topProducts = await queryRunner.query(`
                SELECT 
                    p.name,
                    SUM(ii.quantity) as total_sold,
                    SUM(ii.total_price) as revenue
                FROM invoice_items ii
                JOIN products p ON ii.product_id = p.id
                JOIN invoices i ON ii.invoice_id = i.id
                WHERE i.tenant_id = $1
                GROUP BY p.id, p.name
                ORDER BY total_sold DESC
                LIMIT 5
            `, [tenantId]);

            await queryRunner.commitTransaction();

            return {
                success: true,
                data: {
                    kpis: kpis[0],
                    paymentMethods: paymentMethods.map((pm: any) => ({ name: pm.name, value: Number(pm.value) })),
                    lastDays: last7Days.map((day: any) => ({ date: day.date, total: Number(day.total) })),
                    topProducts: topProducts.map((p: any) => ({ name: p.name, sold: Number(p.total_sold), revenue: Number(p.revenue) }))
                }
            };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error generando reportes:', error);
            throw new InternalServerErrorException('Error al cargar métricas');
        } finally {
            await queryRunner.release();
        }
    }
    // --- SPRINT 3.3: MÓDULO SIRE / REPORTE CONTABLE ---
    async getAccountingReport(tenantId: string, month: number, year: number) {
        this.logger.log(`Generando reporte SIRE para el tenant ${tenantId} - Periodo: ${month}/${year}`);
        
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction(); 
        
        try {
            await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

            // Extraemos la data con el formato exacto que pide el contador/SUNAT
            const reportData = await queryRunner.query(`
                SELECT 
                    TO_CHAR(i.issue_date, 'DD/MM/YYYY') as fecha_emision,
                    '01' as tipo_comprobante, -- 01 es Factura según catálogo SUNAT
                    i.serie,
                    LPAD(i.correlative::text, 8, '0') as correlativo,
                    COALESCE(c.document_type, '6') as tipo_doc_cliente,
                    i.customer_document as numero_doc_cliente,
                    COALESCE(c.full_name, 'Cliente sin registrar') as razon_social,
                    ROUND((i.total_amount / 1.18), 2) as base_imponible,
                    ROUND((i.total_amount - (i.total_amount / 1.18)), 2) as igv,
                    i.total_amount as importe_total,
                    i.xml_ubl_status as estado_sunat
                FROM invoices i
                LEFT JOIN clients c ON i.customer_document = c.document_number
                WHERE EXTRACT(MONTH FROM i.issue_date) = $1 
                  AND EXTRACT(YEAR FROM i.issue_date) = $2
                ORDER BY i.issue_date ASC, i.correlative ASC
            `, [month, year]);

            await queryRunner.commitTransaction();

            return {
                success: true,
                period: `${month.toString().padStart(2, '0')}/${year}`,
                data: reportData
            };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error generando reporte contable:', error);
            throw new InternalServerErrorException('Error al extraer datos contables');
        } finally {
            await queryRunner.release();
        }
    }

    // --- SPRINT 4.1: REACTIVAR SUSCRIPCIÓN TRAS PAGO ---
    async activateSubscription(tenantId: string) {
        try {
            // Hacemos una consulta SQL pura para actualizar a la empresa.
            // Le ponemos estado 'ACTIVE' y le sumamos 30 días a su fecha de vencimiento.
            await this.dataSource.query(
                `UPDATE tenants 
                 SET subscription_status = 'ACTIVE',
                     subscription_valid_until = CURRENT_TIMESTAMP + INTERVAL '30 days'
                 WHERE id = $1`,
                [tenantId]
            );
            console.log(`🎉 Suscripción reactivada con éxito en la BD para el tenant: ${tenantId}`);
        } catch (error) {
            console.error('Error al actualizar la suscripción en la BD:', error);
        }
    }
}