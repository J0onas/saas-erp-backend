import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ReportsService {
    constructor(private readonly dataSource: DataSource) {}

    // ── EXPORTAR SIRE EN CSV (formato exacto SUNAT) ───────────────────────────
    async exportSireCSV(tenantId: string, month: number, year: number): Promise<string> {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            const [company] = await queryRunner.query(
                `SELECT ruc, business_name FROM company_settings WHERE tenant_id = $1`,
                [tenantId]
            );

            const rows = await queryRunner.query(`
                SELECT
                    TO_CHAR(i.issue_date, 'YYYY-MM-DD')        AS fecha_emision,
                    CASE WHEN i.serie LIKE 'F%' THEN '01' ELSE '03' END AS tipo_comp,
                    i.serie                                    AS serie,
                    LPAD(i.correlative::text, 8, '0')          AS correlativo,
                    COALESCE(c.document_type, '6')             AS tipo_doc_cliente,
                    i.customer_document                        AS num_doc_cliente,
                    COALESCE(c.full_name, 'SIN NOMBRE')        AS razon_social,
                    ROUND((i.total_amount / 1.18), 2)          AS base_imponible,
                    ROUND((i.total_amount - i.total_amount / 1.18), 2) AS igv,
                    i.total_amount                             AS total,
                    i.xml_ubl_status                           AS estado_sunat,
                    CASE WHEN i.cancelled THEN 'ANULADA' ELSE '' END AS anulacion
                FROM invoices i
                LEFT JOIN clients c
                    ON i.customer_document = c.document_number
                WHERE EXTRACT(MONTH FROM i.issue_date) = $1
                  AND EXTRACT(YEAR  FROM i.issue_date) = $2
                ORDER BY i.issue_date ASC, i.correlative ASC
            `, [month, year]);

            await queryRunner.commitTransaction();

            // ── Generar CSV con cabecera SIRE ─────────────────────────────────
            const periodo = `${year}${String(month).padStart(2, '0')}`;
            const ruc     = company?.ruc || '00000000000';

            const headers = [
                'PERIODO', 'RUC EMISOR', 'RAZON SOCIAL EMISOR',
                'TIPO COMP.', 'SERIE', 'CORRELATIVO',
                'FECHA EMISION', 'TIPO DOC CLIENTE', 'NUM DOC CLIENTE',
                'RAZON SOCIAL CLIENTE', 'BASE IMPONIBLE', 'IGV',
                'TOTAL', 'ESTADO SUNAT', 'OBSERVACIONES',
            ].join(',');

            const csvRows = rows.map((r: any) => [
                periodo,
                ruc,
                `"${company?.business_name || ''}"`,
                r.tipo_comp,
                r.serie,
                r.correlativo,
                r.fecha_emision,
                r.tipo_doc_cliente,
                r.num_doc_cliente,
                `"${r.razon_social}"`,
                r.base_imponible,
                r.igv,
                r.total,
                r.estado_sunat || 'PENDIENTE',
                r.anulacion || '',
            ].join(','));

            return [headers, ...csvRows].join('\n');

        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error generando SIRE CSV.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── EXPORTAR REPORTE DE VENTAS EN CSV ─────────────────────────────────────
    async exportVentasCSV(
        tenantId: string,
        desde: string,
        hasta: string,
        branchId?: string
    ): Promise<string> {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            const rows = await queryRunner.query(`
                SELECT
                    TO_CHAR(i.issue_date, 'DD/MM/YYYY') AS fecha,
                    CONCAT(i.serie, '-', LPAD(i.correlative::text,8,'0')) AS comprobante,
                    CASE WHEN i.serie LIKE 'F%' THEN 'Factura' ELSE 'Boleta' END AS tipo,
                    COALESCE(c.full_name, 'Sin registrar')  AS cliente,
                    i.customer_document                     AS documento,
                    i.payment_method                        AS metodo_pago,
                    ROUND((i.total_amount / 1.18), 2)       AS subtotal,
                    ROUND((i.total_amount - i.total_amount/1.18), 2) AS igv,
                    i.total_amount                          AS total,
                    COALESCE(b.name, 'Sin sucursal')        AS sucursal,
                    CASE WHEN i.cancelled THEN 'ANULADA' ELSE 'VIGENTE' END AS estado
                FROM invoices i
                LEFT JOIN clients  c ON i.customer_document = c.document_number
                LEFT JOIN branches b ON i.branch_id = b.id
                WHERE i.issue_date BETWEEN $1 AND $2
                  ${branchId ? 'AND i.branch_id = $3' : ''}
                ORDER BY i.issue_date ASC, i.correlative ASC
            `, branchId ? [desde, hasta, branchId] : [desde, hasta]);

            await queryRunner.commitTransaction();

            const headers = [
                'FECHA', 'COMPROBANTE', 'TIPO', 'CLIENTE', 'DOCUMENTO',
                'MÉTODO DE PAGO', 'SUBTOTAL (SIN IGV)', 'IGV (18%)',
                'TOTAL', 'SUCURSAL', 'ESTADO',
            ].join(',');

            const csvRows = rows.map((r: any) => [
                r.fecha, r.comprobante, r.tipo,
                `"${r.cliente}"`, r.documento,
                r.metodo_pago,
                r.subtotal, r.igv, r.total,
                `"${r.sucursal}"`, r.estado,
            ].join(','));

            return [headers, ...csvRows].join('\n');

        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error generando reporte de ventas.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── RESUMEN MENSUAL JSON (para tabla en frontend) ─────────────────────────
    async getMonthlySummary(tenantId: string, year: number) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const data = await queryRunner.query(`
                SELECT
                    EXTRACT(MONTH FROM issue_date)::int          AS mes,
                    TO_CHAR(DATE_TRUNC('month', issue_date), 'Mon') AS mes_nombre,
                    COUNT(*)::int                                AS total_comprobantes,
                    COUNT(*) FILTER (WHERE serie LIKE 'F%')::int AS facturas,
                    COUNT(*) FILTER (WHERE serie LIKE 'B%')::int AS boletas,
                    COUNT(*) FILTER (WHERE cancelled = true)::int AS anuladas,
                    ROUND(SUM(total_amount) FILTER (WHERE NOT COALESCE(cancelled, false)), 2) AS total_facturado,
                    ROUND(SUM(total_amount - total_amount/1.18) FILTER (WHERE NOT COALESCE(cancelled, false)), 2) AS total_igv
                FROM invoices
                WHERE EXTRACT(YEAR FROM issue_date) = $1
                GROUP BY EXTRACT(MONTH FROM issue_date), DATE_TRUNC('month', issue_date)
                ORDER BY mes ASC
            `, [year]);
            await queryRunner.commitTransaction();
            return { success: true, data, year };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error generando resumen mensual.');
        } finally {
            await queryRunner.release();
        }
    }
}
