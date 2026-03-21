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

    // ── EMITIR FACTURA ────────────────────────────────────────────────────────
    async processNewInvoice(invoiceData: CreateInvoiceDto, tenantId: string) {
        this.logger.log(`Procesando factura para tenant ${tenantId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let invoiceId: string;
        let realSerieNumber: string;
        const metodoPago = (invoiceData as any).paymentMethod || 'EFECTIVO';
        const serie = 'F001';

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`,
                [tenantId]
            );

            // ── FIX: Leer datos de la empresa desde company_settings ──────────
            // Así el PDF siempre muestra el nombre real guardado en configuración,
            // NO el valor hardcodeado "EMPRESA LOCAL" que venía del frontend.
            const settingsResult = await queryRunner.query(
                `SELECT business_name, ruc, address, email
                 FROM company_settings
                 WHERE tenant_id = $1`,
                [tenantId]
            );

            const companySettings = settingsResult.length > 0
                ? settingsResult[0]
                : { business_name: 'Empresa Sin Configurar', ruc: '00000000000', address: '' };

            // Sobreescribimos el supplier del frontend con los datos reales de la BD
            (invoiceData as any).supplier = {
                ruc: companySettings.ruc,
                businessName: companySettings.business_name,
                address: companySettings.address || '',
                addressCode: '0000',
            };

            // ── Guardar / actualizar cliente ──────────────────────────────────
            const clientExists = await queryRunner.query(
                `SELECT id FROM clients WHERE document_number = $1`,
                [invoiceData.customer.documentNumber]
            );
            if (clientExists.length === 0) {
                await queryRunner.query(
                    `INSERT INTO clients (tenant_id, document_type, document_number, full_name)
                     VALUES ($1, $2, $3, $4)`,
                    [tenantId, invoiceData.customer.documentType || '6',
                     invoiceData.customer.documentNumber, invoiceData.customer.fullName]
                );
            } else {
                // Actualizamos el nombre por si cambió
                await queryRunner.query(
                    `UPDATE clients SET full_name = $1
                     WHERE document_number = $2 AND tenant_id::text = $3`,
                    [invoiceData.customer.fullName, invoiceData.customer.documentNumber, tenantId]
                );
            }

            // ── Correlativo con bloqueo concurrente (FOR UPDATE) ──────────────
            const seqResult = await queryRunner.query(
                `SELECT correlative FROM invoices
                 WHERE serie = $1 AND tenant_id = $2
                 ORDER BY correlative DESC LIMIT 1 FOR UPDATE`,
                [serie, tenantId]
            );
            const nextCorrelative = seqResult.length > 0
                ? parseInt(seqResult[0].correlative) + 1
                : 1;

            realSerieNumber = `${serie}-${nextCorrelative.toString().padStart(8, '0')}`;
            invoiceData.serieNumber = realSerieNumber;

            // ── Detracciones ──────────────────────────────────────────────────
            const tieneDetraccion = (invoiceData as any).hasDetraction || false;
            const detPorcentaje = (invoiceData as any).detractionPercent || 0;
            const detMonto = (invoiceData as any).detractionAmount || 0;

            // ── Insertar cabecera de factura ──────────────────────────────────
            const insertResult = await queryRunner.query(
                `INSERT INTO invoices
                 (tenant_id, customer_document, total_amount, serie, correlative,
                  issue_date, issue_time, payment_method,
                  has_detraction, detraction_percent, detraction_amount)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING id`,
                [tenantId, invoiceData.customer.documentNumber, invoiceData.totalAmount,
                 serie, nextCorrelative, invoiceData.issueDate, invoiceData.issueTime,
                 metodoPago, tieneDetraccion, detPorcentaje, detMonto]
            );
            invoiceId = insertResult[0].id;

            // ── Detalle de ítems + validación de stock ────────────────────────
            if (invoiceData.items && invoiceData.items.length > 0) {
                for (const item of invoiceData.items) {
                    const productId = (item as any).productId || null;

                    if (productId) {
                        // ── VALIDACIÓN DE STOCK (bloqueo FOR UPDATE) ──────────
                        const productResult = await queryRunner.query(
                            `SELECT name, stock_quantity
                             FROM products
                             WHERE id = $1 AND tenant_id = $2
                             FOR UPDATE`,
                            [productId, tenantId]
                        );

                        if (productResult.length === 0) {
                            throw new Error(
                                `Producto "${item.description}" no encontrado en tu catálogo.`
                            );
                        }

                        const stockActual = Number(productResult[0].stock_quantity);

                        if (stockActual < item.quantity) {
                            throw new Error(
                                `Stock insuficiente para "${productResult[0].name}". ` +
                                `Disponible: ${stockActual}, solicitado: ${item.quantity}.`
                            );
                        }

                        // ── Descontar stock ───────────────────────────────────
                        await queryRunner.query(
                            `UPDATE products
                             SET stock_quantity = stock_quantity - $1
                             WHERE id = $2 AND tenant_id = $3`,
                            [item.quantity, productId, tenantId]
                        );

                        // ── Kardex de salida ──────────────────────────────────
                        // Nota: si la tabla inventory_movements no existe aún,
                        // comentar las líneas del INSERT de abajo hasta crearla.
                        try {
                            await queryRunner.query(
                                `INSERT INTO inventory_movements
                                 (tenant_id, product_id, type, quantity, reason)
                                 VALUES ($1, $2, 'OUTPUT', $3, $4)`,
                                [tenantId, productId, item.quantity,
                                 `Venta ${realSerieNumber}`]
                            );
                        } catch {
                            // Si la tabla no existe todavía, seguimos sin bloquear la venta
                            this.logger.warn('Tabla inventory_movements no existe aún. Omitiendo registro de kardex.');
                        }
                    }

                    // ── Línea de factura ──────────────────────────────────────
                    await queryRunner.query(
                        `INSERT INTO invoice_items
                         (invoice_id, description, quantity, unit_price, total_price)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [invoiceId, item.description, item.quantity,
                         item.unitPrice, item.quantity * item.unitPrice]
                    );
                }
            }

            await queryRunner.commitTransaction();

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error guardando factura:', error.message);
            throw new InternalServerErrorException(
                error.message || 'No se pudo guardar la factura.'
            );
        } finally {
            await queryRunner.release();
        }

        // ── Simulación SUNAT (reemplazar con OSE real en Fase 1) ─────────────
        const xmlContent = SunatXmlBuilder.generateInvoiceXml(invoiceData as any);

        try {
            await lastValueFrom(
                this.httpService.post('https://jsonplaceholder.typicode.com/posts', { data: 'test' })
            );
            await this.dataSource.transaction(async (manager) => {
                await manager.query(
                    `SELECT set_config('app.current_tenant', $1, true)`,
                    [tenantId]
                );
                await manager.query(
                    `UPDATE invoices SET xml_ubl_status = 'ACCEPTED'
                     WHERE id = $1 AND tenant_id = $2`,
                    [invoiceId, tenantId]
                );
            });
        } catch {
            this.logger.warn('No se pudo comunicar con SUNAT simulado.');
        }

        // ── Generar PDF con datos reales de la empresa ────────────────────────
        const pdfBase64 = await PdfBuilder.generateInvoicePdf(invoiceData as any);

        // ── Enviar correo (no bloquea si falla) ───────────────────────────────
        const customerEmail = (invoiceData as any).customerEmail;
        if (customerEmail) {
            this.logger.log(`Enviando correo a ${customerEmail}...`);
            this.emailService.sendInvoiceEmail(
                customerEmail,
                invoiceData.customer.fullName,
                realSerieNumber,
                pdfBase64
            );
        }

        // ── Link de WhatsApp pre-armado ───────────────────────────────────────
        const whatsappText = encodeURIComponent(
            `Hola ${invoiceData.customer.fullName}, le enviamos su comprobante ` +
            `*${realSerieNumber}* por un total de *S/ ${invoiceData.totalAmount.toFixed(2)}*. ` +
            `Gracias por su preferencia.`
        );
        const whatsappLink = `https://wa.me/?text=${whatsappText}`;

        return {
            success: true,
            message: `Factura ${realSerieNumber} emitida exitosamente`,
            document: realSerieNumber,
            dbId: invoiceId,
            xmlPreview: xmlContent,
            pdfDocument: pdfBase64,
            whatsappLink,  // ← el frontend mostrará el botón de WhatsApp con este link
        };
    }

    // ── HISTORIAL DE COMPROBANTES ─────────────────────────────────────────────
    async getInvoicesHistory(tenantId: string) {
        this.logger.log(`Historial para tenant ${tenantId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`,
                [tenantId]
            );

            const invoices = await queryRunner.query(
                `SELECT
                    i.id,
                    CONCAT(i.serie, '-', LPAD(i.correlative::text, 8, '0')) AS comprobante,
                    TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS fecha,
                    i.customer_document,
                    c.full_name,
                    i.total_amount,
                    i.payment_method,
                    i.xml_ubl_status
                    i.serie,
                    i.cancelled
                 FROM invoices i
                 LEFT JOIN clients c ON i.customer_document = c.document_number
                 ORDER BY i.correlative DESC`
            );

            await queryRunner.commitTransaction();
            return invoices;

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error obteniendo historial:', error);
            throw new InternalServerErrorException('No se pudo obtener el historial.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── REGENERAR PDF DESDE HISTORIAL ─────────────────────────────────────────
    async getInvoicePdf(invoiceId: string, tenantId: string) {
        this.logger.log(`Regenerando PDF de factura ${invoiceId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`,
                [tenantId]
            );

            const [invoice] = await queryRunner.query(
                `SELECT i.id, i.customer_document, i.total_amount, i.serie, i.correlative,
                        TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS formatted_issue_date,
                        i.issue_time, i.payment_method,
                        i.has_detraction, i.detraction_percent, i.detraction_amount,
                        c.full_name, c.document_type
                 FROM invoices i
                 LEFT JOIN clients c ON i.customer_document = c.document_number
                 WHERE i.id = $1`,
                [invoiceId]
            );

            if (!invoice) {
                throw new InternalServerErrorException('Factura no encontrada');
            }

            const itemsResult = await queryRunner.query(
                `SELECT * FROM invoice_items WHERE invoice_id = $1`,
                [invoiceId]
            );

            // Datos reales de la empresa
            const settingsResult = await queryRunner.query(
                `SELECT business_name, ruc, address
                 FROM company_settings WHERE tenant_id = $1`,
                [tenantId]
            );
            const company = settingsResult.length > 0
                ? settingsResult[0]
                : { business_name: 'Empresa Sin Configurar', ruc: '00000000000', address: '' };

            const amount = Number(invoice.total_amount);
            const subtotal = amount / 1.18;
            const igv = amount - subtotal;

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
                    address: company.address,
                },
                customer: {
                    documentType: invoice.document_type || '6',
                    documentNumber: invoice.customer_document,
                    fullName: invoice.full_name || 'Cliente Sin Registrar',
                },
                items: itemsResult.length > 0
                    ? itemsResult.map((item: any) => ({
                        description: item.description,
                        quantity: item.quantity,
                        unitValue: Number((item.unit_price / 1.18).toFixed(2)),
                        unitPrice: Number(item.unit_price),
                        totalTaxes: Number((item.unit_price - item.unit_price / 1.18).toFixed(2)),
                    }))
                    : [{ description: 'Servicio', quantity: 1, unitValue: subtotal, unitPrice: amount, totalTaxes: igv }],
                totalTaxBase: subtotal,
                totalIgv: igv,
                totalAmount: amount,
            };

            const pdfBase64 = await PdfBuilder.generateInvoicePdf(realData as any);
            await queryRunner.commitTransaction();
            return { pdfDocument: pdfBase64 };

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error regenerando PDF:', error.message);
            throw new InternalServerErrorException('No se pudo generar el documento.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── MÉTRICAS DEL DASHBOARD ────────────────────────────────────────────────
    async getDashboardMetrics(tenantId: string) {
        this.logger.log(`Métricas para tenant: ${tenantId}`);
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`,
                [tenantId]
            );

            const kpis = await queryRunner.query(`
                SELECT
                    COUNT(id) AS total_invoices,
                    COALESCE(SUM(total_amount), 0) AS total_revenue,
                    COALESCE(AVG(total_amount), 0) AS average_ticket
                FROM invoices
            `);

            const paymentMethods = await queryRunner.query(`
                SELECT payment_method AS name, COALESCE(SUM(total_amount), 0) AS value
                FROM invoices
                GROUP BY payment_method
            `);

            const last7Days = await queryRunner.query(`
                SELECT TO_CHAR(issue_date, 'DD/MM') AS date,
                       COALESCE(SUM(total_amount), 0) AS total
                FROM invoices
                WHERE issue_date >= CURRENT_DATE - INTERVAL '6 days'
                GROUP BY issue_date
                ORDER BY issue_date ASC
            `);

            // Top productos: funciona solo si inventory_movements o invoice_items tiene product_id
            let topProducts: any[] = [];
            try {
                topProducts = await queryRunner.query(`
                    SELECT
                        ii.description AS name,
                        SUM(ii.quantity) AS total_sold,
                        SUM(ii.total_price) AS revenue
                    FROM invoice_items ii
                    JOIN invoices i ON ii.invoice_id = i.id
                    WHERE i.tenant_id = $1
                    GROUP BY ii.description
                    ORDER BY total_sold DESC
                    LIMIT 5
                `, [tenantId]);
            } catch {
                this.logger.warn('No se pudo obtener top productos.');
            }

            await queryRunner.commitTransaction();

            return {
                success: true,
                data: {
                    kpis: kpis[0],
                    paymentMethods: paymentMethods.map((pm: any) => ({
                        name: pm.name, value: Number(pm.value),
                    })),
                    lastDays: last7Days.map((d: any) => ({
                        date: d.date, total: Number(d.total),
                    })),
                    topProducts: topProducts.map((p: any) => ({
                        name: p.name, sold: Number(p.total_sold), revenue: Number(p.revenue),
                    })),
                },
            };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error generando métricas:', error);
            throw new InternalServerErrorException('Error al cargar métricas');
        } finally {
            await queryRunner.release();
        }
    }

    // ── REPORTE CONTABLE SIRE ─────────────────────────────────────────────────
    async getAccountingReport(tenantId: string, month: number, year: number) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`,
                [tenantId]
            );

            const reportData = await queryRunner.query(`
                SELECT
                    TO_CHAR(i.issue_date, 'DD/MM/YYYY') AS fecha_emision,
                    '01' AS tipo_comprobante,
                    i.serie,
                    LPAD(i.correlative::text, 8, '0') AS correlativo,
                    COALESCE(c.document_type, '6') AS tipo_doc_cliente,
                    i.customer_document AS numero_doc_cliente,
                    COALESCE(c.full_name, 'Cliente sin registrar') AS razon_social,
                    ROUND((i.total_amount / 1.18), 2) AS base_imponible,
                    ROUND((i.total_amount - (i.total_amount / 1.18)), 2) AS igv,
                    i.total_amount AS importe_total,
                    i.xml_ubl_status AS estado_sunat
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
                data: reportData,
            };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error al extraer datos contables');
        } finally {
            await queryRunner.release();
        }
    }

    // ── ACTIVAR SUSCRIPCIÓN (post-pago MercadoPago) ───────────────────────────
    async activateSubscription(tenantId: string) {
        try {
            await this.dataSource.query(
                `UPDATE tenants
                 SET subscription_status = 'ACTIVE',
                     subscription_valid_until = CURRENT_TIMESTAMP + INTERVAL '30 days'
                 WHERE id = $1`,
                [tenantId]
            );
            this.logger.log(`✅ Suscripción activada para tenant: ${tenantId}`);
        } catch (error) {
            this.logger.error('Error activando suscripción:', error);
        }
    }
}
