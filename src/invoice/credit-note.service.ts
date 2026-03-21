import {
    Injectable, Logger,
    InternalServerErrorException,
    BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PdfBuilder } from '../invoice/utils/PdfBuilder';

@Injectable()
export class CreditNoteService {
    private readonly logger = new Logger(CreditNoteService.name);

    constructor(private readonly dataSource: DataSource) {}

    // ── ANULAR FACTURA Y GENERAR NOTA DE CRÉDITO ──────────────────────────────
    async createCreditNote(
        invoiceId: string,
        tenantId: string,
        reason: string
    ) {
        this.logger.log(`Anulando factura ${invoiceId} para tenant ${tenantId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let creditNoteNumber: string;

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            // Primero bloqueamos solo la factura con FOR UPDATE
            const [invoice] = await queryRunner.query(
                `SELECT * FROM invoices
                 WHERE id = $1 AND tenant_id = $2
                 FOR UPDATE`,
                [invoiceId, tenantId]
            );

            // Luego traemos el nombre del cliente por separado (sin FOR UPDATE)
            if (invoice) {
                const [cliente] = await queryRunner.query(
                    `SELECT full_name, document_type FROM clients
                     WHERE document_number = $1`,
                    [invoice.customer_document]
                );
                invoice.full_name = cliente?.full_name || 'Cliente sin registrar';
                invoice.document_type = cliente?.document_type || '6';
            }

            if (!invoice) {
                throw new BadRequestException('Factura no encontrada.');
            }

            if (invoice.cancelled) {
                throw new BadRequestException('Esta factura ya fue anulada anteriormente.');
            }

            
            const [fechaCheck] = await queryRunner.query(
                `SELECT
                 issue_date,
                 (NOW() AT TIME ZONE 'America/Lima')::date AS hoy_lima,
                 issue_date = (NOW() AT TIME ZONE 'America/Lima')::date AS es_hoy
                 FROM invoices WHERE id = $1`,
                [invoiceId]
            );

            this.logger.log(`Fecha factura: ${fechaCheck?.issue_date} | Hoy Lima: ${fechaCheck?.hoy_lima} | Es hoy: ${fechaCheck?.es_hoy}`);

            if (!fechaCheck?.es_hoy) {
                throw new BadRequestException(
                    'Solo se pueden anular comprobantes emitidos el día de hoy. ' +
                    'Para anulaciones de días anteriores contacta a tu contador.'
                );
            }

            // ── Correlativo de la nota de crédito ─────────────────────────────
            const serieCN = invoice.serie?.startsWith('B') ? 'BC01' : 'FC01';
            const [seqResult] = await queryRunner.query(
                `SELECT COALESCE(MAX(correlative), 0) + 1 AS next
                 FROM credit_notes
                 WHERE tenant_id = $1 AND serie = $2`,
                [tenantId, serieCN]
            );
            const nextCorrelative = parseInt(seqResult.next);
            creditNoteNumber = `${serieCN}-${nextCorrelative.toString().padStart(8, '0')}`;

            // ── Crear nota de crédito ─────────────────────────────────────────
            await queryRunner.query(
                `INSERT INTO credit_notes
                 (tenant_id, invoice_id, serie, correlative, reason, total_amount, xml_ubl_status)
                 VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
                [tenantId, invoiceId, serieCN, nextCorrelative, reason, invoice.total_amount]
            );

            // ── Marcar factura original como anulada ──────────────────────────
            await queryRunner.query(
                `UPDATE invoices
                 SET cancelled = true,
                     cancelled_at = NOW(),
                     xml_ubl_status = 'ANULADA'
                 WHERE id = $1 AND tenant_id = $2`,
                [invoiceId, tenantId]
            );

            // ── Restaurar stock de los ítems ──────────────────────────────────
            const items = await queryRunner.query(
                `SELECT ii.*, p.name AS product_name
                 FROM invoice_items ii
                 LEFT JOIN products p ON ii.product_id = p.id
                 WHERE ii.invoice_id = $1`,
                [invoiceId]
            );

            for (const item of items) {
                if (item.product_id) {
                    await queryRunner.query(
                        `UPDATE products
                         SET stock_quantity = stock_quantity + $1
                         WHERE id = $2 AND tenant_id = $3`,
                        [item.quantity, item.product_id, tenantId]
                    );

                    // Kardex de devolución
                    try {
                        await queryRunner.query(
                            `INSERT INTO inventory_movements
                             (tenant_id, product_id, type, quantity, reason)
                             VALUES ($1, $2, 'RETURN', $3, $4)`,
                            [tenantId, item.product_id, item.quantity,
                             `Anulación ${creditNoteNumber}`]
                        );
                    } catch {
                        this.logger.warn('inventory_movements no disponible aún.');
                    }
                }
            }

            await queryRunner.commitTransaction();

            this.logger.log(`Nota de crédito ${creditNoteNumber} creada exitosamente`);

            return {
                success: true,
                message: `Factura anulada. Nota de crédito ${creditNoteNumber} generada.`,
                creditNoteNumber,
                originalInvoice: invoice.serie + '-' +
                    Number(invoice.correlative).toString().padStart(8, '0'),
            };

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error anulando factura:', error.message);
            if (error instanceof BadRequestException) throw error;
            throw new InternalServerErrorException(
                error.message || 'No se pudo anular la factura.'
            );
        } finally {
            await queryRunner.release();
        }
    }

    // ── LISTAR NOTAS DE CRÉDITO ───────────────────────────────────────────────
    async getCreditNotes(tenantId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const notes = await queryRunner.query(`
                SELECT
                    cn.id,
                    CONCAT(cn.serie, '-', LPAD(cn.correlative::text, 8, '0')) AS nota,
                    CONCAT(i.serie, '-', LPAD(i.correlative::text, 8, '0'))   AS factura_original,
                    cn.reason,
                    cn.total_amount,
                    TO_CHAR(cn.created_at, 'YYYY-MM-DD') AS fecha,
                    c.full_name
                FROM credit_notes cn
                LEFT JOIN invoices i ON cn.invoice_id = i.id
                LEFT JOIN clients  c ON i.customer_document = c.document_number
                WHERE cn.tenant_id = $1
                ORDER BY cn.created_at DESC
            `, [tenantId]);
            await queryRunner.commitTransaction();
            return { success: true, data: notes };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error obteniendo notas de crédito.');
        } finally {
            await queryRunner.release();
        }
    }
}
