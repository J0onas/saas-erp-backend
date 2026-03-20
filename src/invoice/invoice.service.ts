import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PdfBuilder } from './utils/PdfBuilder';
import { HttpService } from '@nestjs/axios';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { SunatXmlBuilder } from './utils/SunatXmlBuilder';
import { NubefactService } from './utils/NubefactService';
import { DataSource } from 'typeorm';
import { EmailService } from '../email/email.service';

@Injectable()
export class InvoiceService {
    private readonly logger = new Logger(InvoiceService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly httpService: HttpService,
        private readonly emailService: EmailService,
        private readonly nubefact: NubefactService,
    ) {}

    // ── EMITIR COMPROBANTE (Factura F001 o Boleta B001) ──────────────────────
    async processNewInvoice(invoiceData: CreateInvoiceDto, tenantId: string) {
        this.logger.log(`Procesando comprobante para tenant ${tenantId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let invoiceId: string;
        let realSerieNumber: string;
        const metodoPago = (invoiceData as any).paymentMethod || 'EFECTIVO';

        // ── DETERMINAR TIPO DE COMPROBANTE ────────────────────────────────────
        // Si el frontend manda tipoComprobante lo usamos.
        // Si no, se infiere por el documento del cliente:
        //   DNI (8 dígitos) → Boleta '03' / serie B001
        //   RUC (11 dígitos) → Factura '01' / serie F001
        const docLength = invoiceData.customer.documentNumber.length;
        const tipoComprobante: '01' | '03' =
            (invoiceData as any).tipoComprobante ||
            (docLength === 8 ? '03' : '01');

        const serie = tipoComprobante === '03' ? 'B001' : 'F001';

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`,
                [tenantId]
            );

            // ── Datos reales de la empresa ────────────────────────────────────
            const settingsResult = await queryRunner.query(
                `SELECT business_name, ruc, address, email
                 FROM company_settings WHERE tenant_id = $1`,
                [tenantId]
            );

            if (settingsResult.length === 0 || !settingsResult[0].ruc) {
                throw new Error(
                    'Debes configurar los datos de tu empresa (RUC y Razón Social) ' +
                    'antes de emitir comprobantes. Ve a ⚙️ Mi Empresa.'
                );
            }

            const company = settingsResult[0];

            (invoiceData as any).supplier = {
                ruc: company.ruc,
                businessName: company.business_name,
                address: company.address || '',
                addressCode: '0000',
            };
            (invoiceData as any).tipoComprobante = tipoComprobante;

            // ── Guardar / actualizar cliente ──────────────────────────────────
            const clientExists = await queryRunner.query(
                `SELECT id FROM clients WHERE document_number = $1 AND tenant_id::text = $2`,
                [invoiceData.customer.documentNumber, tenantId]
            );

            if (clientExists.length === 0) {
                await queryRunner.query(
                    `INSERT INTO clients
                     (tenant_id, document_type, document_number, full_name)
                     VALUES ($1, $2, $3, $4)`,
                    [tenantId,
                     invoiceData.customer.documentType || (tipoComprobante === '03' ? '1' : '6'),
                     invoiceData.customer.documentNumber,
                     invoiceData.customer.fullName]
                );
            }

            // ── Correlativo con bloqueo concurrente ───────────────────────────
            // FOR UPDATE garantiza que dos cajeros simultáneos no tomen el mismo número
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

            // ── Insertar cabecera del comprobante ─────────────────────────────
            const insertResult = await queryRunner.query(
                `INSERT INTO invoices
                 (tenant_id, customer_document, total_amount, serie, correlative,
                  issue_date, issue_time, payment_method,
                  has_detraction, detraction_percent, detraction_amount,
                  xml_ubl_status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDIENTE')
                 RETURNING id`,
                [tenantId, invoiceData.customer.documentNumber, invoiceData.totalAmount,
                 serie, nextCorrelative, invoiceData.issueDate, invoiceData.issueTime,
                 metodoPago, tieneDetraccion, detPorcentaje, detMonto]
            );
            invoiceId = insertResult[0].id;

            // ── Ítems + validación y descuento de stock ───────────────────────
            if (invoiceData.items?.length > 0) {
                for (const item of invoiceData.items) {
                    const productId = (item as any).productId || null;

                    if (productId) {
                        const productResult = await queryRunner.query(
                            `SELECT name, stock_quantity
                             FROM products
                             WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                            [productId, tenantId]
                        );

                        if (!productResult.length) {
                            throw new Error(`Producto "${item.description}" no encontrado.`);
                        }

                        const stockActual = Number(productResult[0].stock_quantity);
                        if (stockActual < item.quantity) {
                            throw new Error(
                                `Stock insuficiente para "${productResult[0].name}". ` +
                                `Disponible: ${stockActual}, solicitado: ${item.quantity}.`
                            );
                        }

                        await queryRunner.query(
                            `UPDATE products
                             SET stock_quantity = stock_quantity - $1
                             WHERE id = $2 AND tenant_id = $3`,
                            [item.quantity, productId, tenantId]
                        );

                        // Kardex (tabla opcional, no bloquea la venta si no existe)
                        try {
                            await queryRunner.query(
                                `INSERT INTO inventory_movements
                                 (tenant_id, product_id, type, quantity, reason)
                                 VALUES ($1,$2,'OUTPUT',$3,$4)`,
                                [tenantId, productId, item.quantity, `Venta ${realSerieNumber}`]
                            );
                        } catch {
                            this.logger.warn('inventory_movements no existe aún. Omitiendo kardex.');
                        }
                    }

                    await queryRunner.query(
                        `INSERT INTO invoice_items
                         (invoice_id, description, quantity, unit_price, total_price)
                         VALUES ($1,$2,$3,$4,$5)`,
                        [invoiceId, item.description, item.quantity,
                         item.unitPrice, item.quantity * item.unitPrice]
                    );
                }
            }

            await queryRunner.commitTransaction();

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error guardando comprobante:', error.message);
            throw new InternalServerErrorException(error.message || 'No se pudo guardar el comprobante.');
        } finally {
            await queryRunner.release();
        }

        // ── GENERAR XML Y ENVIAR A SUNAT VIA NUBEFACT ────────────────────────
        const xmlContent = SunatXmlBuilder.generateInvoiceXml({
            ...(invoiceData as any),
            tipoComprobante,
        });

        const nubefactResult = await this.nubefact.enviarComprobante(
            xmlContent,
            tipoComprobante,
            serie,
            parseInt(invoiceData.serieNumber.split('-')[1]),
            (invoiceData as any).supplier.ruc
        );

        // Actualizar estado SUNAT en BD
        const nuevoEstado = nubefactResult.accepted ? 'ACCEPTED' : 'REJECTED';
        await this.dataSource.transaction(async (manager) => {
            await manager.query(
                `SELECT set_config('app.current_tenant', $1, true)`,
                [tenantId]
            );
            await manager.query(
                `UPDATE invoices
                 SET xml_ubl_status = $1
                 WHERE id = $2 AND tenant_id = $3`,
                [nuevoEstado, invoiceId, tenantId]
            );
        });

        if (!nubefactResult.accepted && nubefactResult.sunatStatus !== 'ERROR_RED') {
            this.logger.warn(
                `SUNAT rechazó ${realSerieNumber}: ${nubefactResult.sunatDescription}`
            );
        }

        // ── GENERAR PDF ───────────────────────────────────────────────────────
        const pdfBase64 = await PdfBuilder.generateInvoicePdf(invoiceData as any);

        // ── ENVIAR CORREO (no bloquea la respuesta) ───────────────────────────
        const customerEmail = (invoiceData as any).customerEmail;
        if (customerEmail) {
            this.emailService.sendInvoiceEmail(
                customerEmail,
                invoiceData.customer.fullName,
                realSerieNumber,
                pdfBase64
            );
        }

        // ── LINK DE WHATSAPP ──────────────────────────────────────────────────
        const tipoLabel = tipoComprobante === '03' ? 'Boleta' : 'Factura';
        const whatsappText = encodeURIComponent(
            `Hola ${invoiceData.customer.fullName}, le enviamos su ${tipoLabel} ` +
            `*${realSerieNumber}* por un total de *S/ ${invoiceData.totalAmount.toFixed(2)}*. ` +
            `Gracias por su preferencia.`
        );

        return {
            success: true,
            message: `${tipoLabel} ${realSerieNumber} emitida exitosamente`,
            document: realSerieNumber,
            tipoComprobante,
            dbId: invoiceId,
            sunatStatus: nubefactResult.sunatStatus,
            sunatMessage: nubefactResult.sunatDescription,
            pdfDocument: pdfBase64,
            whatsappLink: `https://wa.me/?text=${whatsappText}`,
        };
    }

    // ── HISTORIAL ─────────────────────────────────────────────────────────────
    async getInvoicesHistory(tenantId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const invoices = await queryRunner.query(`
                SELECT
                    i.id,
                    CONCAT(i.serie, '-', LPAD(i.correlative::text, 8, '0')) AS comprobante,
                    TO_CHAR(i.issue_date, 'YYYY-MM-DD') AS fecha,
                    i.customer_document,
                    c.full_name,
                    i.total_amount,
                    i.payment_method,
                    i.xml_ubl_status,
                    i.serie
                FROM invoices i
                LEFT JOIN clients c ON i.customer_document = c.document_number
                ORDER BY i.correlative DESC
            `);
            await queryRunner.commitTransaction();
            return invoices;
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error obteniendo historial.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── REGENERAR PDF ─────────────────────────────────────────────────────────
    async getInvoicePdf(invoiceId: string, tenantId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const [invoice] = await queryRunner.query(
                `SELECT i.*, TO_CHAR(i.issue_date,'YYYY-MM-DD') AS formatted_issue_date,
                        c.full_name, c.document_type
                 FROM invoices i
                 LEFT JOIN clients c ON i.customer_document = c.document_number
                 WHERE i.id = $1`,
                [invoiceId]
            );
            if (!invoice) throw new Error('Factura no encontrada');

            const items = await queryRunner.query(
                `SELECT * FROM invoice_items WHERE invoice_id = $1`, [invoiceId]
            );

            const [company] = await queryRunner.query(
                `SELECT business_name, ruc, address FROM company_settings WHERE tenant_id = $1`,
                [tenantId]
            );

            const amount = Number(invoice.total_amount);
            const subtotal = amount / 1.18;
            const igv = amount - subtotal;

            const data: any = {
                serieNumber: `${invoice.serie}-${Number(invoice.correlative).toString().padStart(8,'0')}`,
                issueDate: invoice.formatted_issue_date,
                issueTime: invoice.issue_time,
                paymentMethod: invoice.payment_method,
                tipoComprobante: invoice.serie?.startsWith('B') ? '03' : '01',
                supplier: {
                    ruc: company?.ruc || '00000000000',
                    businessName: company?.business_name || 'Empresa',
                    address: company?.address || '',
                },
                customer: {
                    documentType: invoice.document_type || '6',
                    documentNumber: invoice.customer_document,
                    fullName: invoice.full_name || 'Cliente',
                },
                items: items.length ? items.map((it: any) => ({
                    description: it.description,
                    quantity: it.quantity,
                    unitValue: Number((it.unit_price / 1.18).toFixed(2)),
                    unitPrice: Number(it.unit_price),
                    totalTaxes: Number((it.unit_price - it.unit_price / 1.18).toFixed(2)),
                })) : [{ description: 'Servicio', quantity: 1, unitValue: subtotal, unitPrice: amount, totalTaxes: igv }],
                totalTaxBase: subtotal,
                totalIgv: igv,
                totalAmount: amount,
            };

            const pdfBase64 = await PdfBuilder.generateInvoicePdf(data);
            await queryRunner.commitTransaction();
            return { pdfDocument: pdfBase64 };

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException(error.message || 'Error generando PDF.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── MÉTRICAS ──────────────────────────────────────────────────────────────
    async getDashboardMetrics(tenantId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            const [kpis] = await queryRunner.query(`
                SELECT COUNT(id) AS total_invoices,
                       COALESCE(SUM(total_amount), 0) AS total_revenue,
                       COALESCE(AVG(total_amount), 0) AS average_ticket
                FROM invoices
            `);
            const paymentMethods = await queryRunner.query(`
                SELECT payment_method AS name, COALESCE(SUM(total_amount),0) AS value
                FROM invoices GROUP BY payment_method
            `);
            const lastDays = await queryRunner.query(`
                SELECT TO_CHAR(issue_date,'DD/MM') AS date, COALESCE(SUM(total_amount),0) AS total
                FROM invoices
                WHERE issue_date >= CURRENT_DATE - INTERVAL '6 days'
                GROUP BY issue_date ORDER BY issue_date ASC
            `);
            let topProducts: any[] = [];
            try {
                topProducts = await queryRunner.query(`
                    SELECT ii.description AS name,
                           SUM(ii.quantity) AS total_sold,
                           SUM(ii.total_price) AS revenue
                    FROM invoice_items ii
                    JOIN invoices i ON ii.invoice_id = i.id
                    WHERE i.tenant_id = $1
                    GROUP BY ii.description
                    ORDER BY total_sold DESC LIMIT 5
                `, [tenantId]);
            } catch { /* tabla invoice_items puede no tener datos */ }

            await queryRunner.commitTransaction();
            return {
                success: true,
                data: {
                    kpis,
                    paymentMethods: paymentMethods.map((p: any) => ({ name: p.name, value: Number(p.value) })),
                    lastDays: lastDays.map((d: any) => ({ date: d.date, total: Number(d.total) })),
                    topProducts: topProducts.map((p: any) => ({
                        name: p.name, sold: Number(p.total_sold), revenue: Number(p.revenue)
                    })),
                },
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error cargando métricas.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── REPORTE SIRE ──────────────────────────────────────────────────────────
    async getAccountingReport(tenantId: string, month: number, year: number) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const data = await queryRunner.query(`
                SELECT TO_CHAR(i.issue_date,'DD/MM/YYYY') AS fecha_emision,
                       CASE WHEN i.serie LIKE 'F%' THEN '01' ELSE '03' END AS tipo_comprobante,
                       i.serie, LPAD(i.correlative::text,8,'0') AS correlativo,
                       COALESCE(c.document_type,'6') AS tipo_doc_cliente,
                       i.customer_document AS numero_doc_cliente,
                       COALESCE(c.full_name,'Sin registrar') AS razon_social,
                       ROUND((i.total_amount/1.18),2) AS base_imponible,
                       ROUND((i.total_amount-(i.total_amount/1.18)),2) AS igv,
                       i.total_amount AS importe_total,
                       i.xml_ubl_status AS estado_sunat
                FROM invoices i
                LEFT JOIN clients c ON i.customer_document = c.document_number
                WHERE EXTRACT(MONTH FROM i.issue_date) = $1
                  AND EXTRACT(YEAR FROM i.issue_date) = $2
                ORDER BY i.issue_date ASC, i.correlative ASC
            `, [month, year]);
            await queryRunner.commitTransaction();
            return { success: true, period: `${String(month).padStart(2,'0')}/${year}`, data };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error exportando SIRE.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── ACTIVAR SUSCRIPCIÓN ───────────────────────────────────────────────────
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
