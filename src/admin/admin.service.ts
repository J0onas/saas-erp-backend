import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class AdminService {
    private readonly logger = new Logger(AdminService.name);

    constructor(private readonly dataSource: DataSource) {}

    // ── LISTAR TODOS LOS TENANTS ──────────────────────────────────────────────
    async getAllTenants(filters: {
        status?: string;
        search?: string;
        page?: number;
        limit?: number;
    }) {
        const page  = filters.page  || 1;
        const limit = filters.limit || 20;
        const offset = (page - 1) * limit;

        const conditions: string[] = ['t.ruc != \'00000000000\''];
        const params: any[] = [];
        let pIdx = 1;

        if (filters.status) {
            conditions.push(`t.subscription_status = $${pIdx++}`);
            params.push(filters.status);
        }
        if (filters.search) {
            conditions.push(`(t.business_name ILIKE $${pIdx} OR t.ruc ILIKE $${pIdx})`);
            params.push(`%${filters.search}%`);
            pIdx++;
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const [tenants, countResult] = await Promise.all([
            this.dataSource.query(`
                SELECT
                    t.id, t.business_name, t.ruc,
                    t.subscription_status, t.subscription_valid_until,
                    TO_CHAR(t.created_at, 'YYYY-MM-DD') AS created_at,
                    COUNT(DISTINCT u.id)::int                AS total_users,
                    COUNT(DISTINCT i.id)::int                AS total_invoices,
                    COALESCE(SUM(i.total_amount), 0)         AS total_revenue,
                    MAX(u.created_at)                        AS last_activity
                FROM tenants t
                LEFT JOIN users u    ON u.tenant_id = t.id
                LEFT JOIN invoices i ON i.tenant_id = t.id
                ${where}
                GROUP BY t.id, t.business_name, t.ruc,
                         t.subscription_status, t.subscription_valid_until, t.created_at
                ORDER BY t.created_at DESC
                LIMIT $${pIdx} OFFSET $${pIdx + 1}
            `, [...params, limit, offset]),

            this.dataSource.query(`
                SELECT COUNT(*)::int AS total
                FROM tenants t ${where}
            `, params),
        ]);

        return {
            success: true,
            data: tenants,
            pagination: {
                total: countResult[0].total,
                page,
                limit,
                pages: Math.ceil(countResult[0].total / limit),
            },
        };
    }

    // ── DETALLE DE UN TENANT ──────────────────────────────────────────────────
    async getTenantDetail(tenantId: string) {
        const [tenant] = await this.dataSource.query(`
            SELECT
                t.*,
                COUNT(DISTINCT u.id)::int            AS total_users,
                COUNT(DISTINCT i.id)::int            AS total_invoices,
                COALESCE(SUM(i.total_amount), 0)     AS total_revenue,
                COUNT(DISTINCT p.id)::int            AS total_products
            FROM tenants t
            LEFT JOIN users    u ON u.tenant_id = t.id
            LEFT JOIN invoices i ON i.tenant_id = t.id
            LEFT JOIN products p ON p.tenant_id = t.id
            WHERE t.id = $1
            GROUP BY t.id
        `, [tenantId]);

        const recentInvoices = await this.dataSource.query(`
            SELECT id, total_amount, xml_ubl_status,
                   TO_CHAR(created_at, 'YYYY-MM-DD') AS fecha
            FROM invoices
            WHERE tenant_id = $1
            ORDER BY created_at DESC LIMIT 5
        `, [tenantId]);

        return {
            success: true,
            data: { ...tenant, recentInvoices },
        };
    }

    // ── ACTIVAR / SUSPENDER TENANT ────────────────────────────────────────────
    async updateTenantStatus(
        tenantId: string,
        status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL',
        extendDays?: number
    ) {
        const validUntil = extendDays
            ? `CURRENT_TIMESTAMP + INTERVAL '${extendDays} days'`
            : 'subscription_valid_until';

        await this.dataSource.query(`
            UPDATE tenants
            SET subscription_status      = $1,
                subscription_valid_until = ${validUntil}
            WHERE id = $2
        `, [status, tenantId]);

        this.logger.log(`Tenant ${tenantId} → ${status}`);

        return {
            success: true,
            message: `Tenant ${status === 'ACTIVE' ? 'activado' : status === 'SUSPENDED' ? 'suspendido' : 'en trial'} correctamente.`,
        };
    }

    // ── MÉTRICAS GLOBALES DEL SAAS ────────────────────────────────────────────
    async getGlobalMetrics() {
        const [general] = await this.dataSource.query(`
            SELECT
                COUNT(DISTINCT t.id)::int                                              AS total_tenants,
                COUNT(DISTINCT CASE WHEN t.subscription_status = 'ACTIVE'     THEN t.id END)::int AS active_tenants,
                COUNT(DISTINCT CASE WHEN t.subscription_status = 'TRIAL'      THEN t.id END)::int AS trial_tenants,
                COUNT(DISTINCT CASE WHEN t.subscription_status = 'SUSPENDED'  THEN t.id END)::int AS suspended_tenants,
                COUNT(DISTINCT CASE
                    WHEN t.created_at >= NOW() - INTERVAL '30 days' THEN t.id
                END)::int                                                              AS new_this_month,
                COUNT(DISTINCT i.id)::int                                              AS total_invoices,
                COALESCE(SUM(i.total_amount), 0)                                       AS total_revenue
            FROM tenants t
            LEFT JOIN invoices i ON i.tenant_id = t.id
            WHERE t.ruc != '00000000000'
        `);

        // Nuevos tenants por mes (últimos 6 meses)
        const growthByMonth = await this.dataSource.query(`
            SELECT
                TO_CHAR(DATE_TRUNC('month', created_at), 'Mon YY') AS mes,
                COUNT(*)::int AS nuevos
            FROM tenants
            WHERE ruc != '00000000000'
              AND created_at >= NOW() - INTERVAL '6 months'
            GROUP BY DATE_TRUNC('month', created_at)
            ORDER BY DATE_TRUNC('month', created_at) ASC
        `);

        // Ingresos por mes (últimos 6 meses) — representa MRR aproximado
        const revenueByMonth = await this.dataSource.query(`
            SELECT
                TO_CHAR(DATE_TRUNC('month', i.created_at), 'Mon YY') AS mes,
                COALESCE(SUM(i.total_amount), 0)                       AS ingresos
            FROM invoices i
            JOIN tenants t ON i.tenant_id = t.id
            WHERE t.ruc != '00000000000'
              AND i.created_at >= NOW() - INTERVAL '6 months'
            GROUP BY DATE_TRUNC('month', i.created_at)
            ORDER BY DATE_TRUNC('month', i.created_at) ASC
        `);

        // Top 5 tenants por volumen de facturación
        const topTenants = await this.dataSource.query(`
            SELECT
                t.business_name,
                COUNT(i.id)::int             AS total_invoices,
                COALESCE(SUM(i.total_amount), 0) AS revenue
            FROM tenants t
            JOIN invoices i ON i.tenant_id = t.id
            WHERE t.ruc != '00000000000'
            GROUP BY t.id, t.business_name
            ORDER BY revenue DESC
            LIMIT 5
        `);

        return {
            success: true,
            data: {
                general,
                growthByMonth,
                revenueByMonth,
                topTenants,
            },
        };
    }

    // ── AUDIT LOGS ────────────────────────────────────────────────────────────
    async getAuditLogs(tenantId?: string, limit = 50) {
        const logs = await this.dataSource.query(`
            SELECT
                al.id, al.action, al.entity, al.metadata,
                al.ip_address,
                TO_CHAR(al.created_at, 'YYYY-MM-DD HH24:MI') AS fecha,
                u.full_name AS user_name, u.email AS user_email,
                t.business_name AS tenant_name
            FROM audit_logs al
            LEFT JOIN users   u ON al.user_id   = u.id
            LEFT JOIN tenants t ON al.tenant_id = t.id
            WHERE ($1::uuid IS NULL OR al.tenant_id = $1)
            ORDER BY al.created_at DESC
            LIMIT $2
        `, [tenantId || null, limit]);

        return { success: true, data: logs };
    }

    // ── REGISTRAR EVENTO EN AUDIT LOG (llamado desde otros servicios) ─────────
    async log(data: {
        tenantId?: string;
        userId?: string;
        action: string;
        entity?: string;
        entityId?: string;
        metadata?: Record<string, any>;
        ip?: string;
    }) {
        try {
            await this.dataSource.query(`
                INSERT INTO audit_logs
                (tenant_id, user_id, action, entity, entity_id, metadata, ip_address)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                data.tenantId   || null,
                data.userId     || null,
                data.action,
                data.entity     || null,
                data.entityId   || null,
                data.metadata   ? JSON.stringify(data.metadata) : null,
                data.ip         || null,
            ]);
        } catch (error) {
            // No bloquear la operación principal si falla el log
            this.logger.warn('No se pudo registrar en audit_logs:', error);
        }
    }
}
