import {
    Injectable, Logger,
    InternalServerErrorException,
    ForbiddenException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class PlansService {
    private readonly logger = new Logger(PlansService.name);

    constructor(private readonly dataSource: DataSource) {}

    // ── LISTAR TODOS LOS PLANES (público) ─────────────────────────────────────
    async getAll() {
        const plans = await this.dataSource.query(
            `SELECT * FROM plans WHERE is_active = true ORDER BY price_monthly ASC`
        );
        return { success: true, data: plans };
    }

    // ── PLAN ACTUAL DEL TENANT ────────────────────────────────────────────────
    async getCurrentPlan(tenantId: string) {
        const [result] = await this.dataSource.query(
            `SELECT p.*, t.subscription_status, t.subscription_valid_until
             FROM tenants t
             LEFT JOIN plans p ON t.plan_id = p.id
             WHERE t.id = $1`,
            [tenantId]
        );
        return { success: true, data: result };
    }

    // ── VERIFICAR LÍMITES DEL PLAN ────────────────────────────────────────────
    // Llamado desde otros servicios antes de crear recursos
    async checkLimit(
        tenantId: string,
        resource: 'users' | 'products' | 'invoices_mo'
    ): Promise<{ allowed: boolean; current: number; max: number; planName: string }> {

        const [tenant] = await this.dataSource.query(
            `SELECT t.plan_id, t.subscription_status, p.max_users,
                    p.max_products, p.max_invoices_mo, p.display_name
             FROM tenants t
             LEFT JOIN plans p ON t.plan_id = p.id
             WHERE t.id = $1`,
            [tenantId]
        );

        // Sin plan asignado = sin restricciones (para tenants legacy)
        if (!tenant?.plan_id) {
            return { allowed: true, current: 0, max: -1, planName: 'Sin plan' };
        }

        let current = 0;
        let max = -1;

        switch (resource) {
            case 'users':
                max = tenant.max_users;
                if (max === -1) break;
                const [userCount] = await this.dataSource.query(
                    `SELECT COUNT(*)::int AS total FROM users WHERE tenant_id = $1`,
                    [tenantId]
                );
                current = userCount.total;
                break;

            case 'products':
                max = tenant.max_products;
                if (max === -1) break;
                const [prodCount] = await this.dataSource.query(
                    `SELECT COUNT(*)::int AS total FROM products WHERE tenant_id = $1`,
                    [tenantId]
                );
                current = prodCount.total;
                break;

            case 'invoices_mo':
                max = tenant.max_invoices_mo;
                if (max === -1) break;
                const [invCount] = await this.dataSource.query(
                    `SELECT COUNT(*)::int AS total FROM invoices
                     WHERE tenant_id = $1
                       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())`,
                    [tenantId]
                );
                current = invCount.total;
                break;
        }

        return {
            allowed: max === -1 || current < max,
            current,
            max,
            planName: tenant.display_name,
        };
    }

    // ── ASIGNAR PLAN A TENANT (solo SUPERADMIN) ───────────────────────────────
    async assignPlan(tenantId: string, planId: string) {
        const [plan] = await this.dataSource.query(
            `SELECT id, display_name FROM plans WHERE id = $1`, [planId]
        );
        if (!plan) throw new InternalServerErrorException('Plan no encontrado.');

        await this.dataSource.query(
            `UPDATE tenants SET plan_id = $1 WHERE id = $2`,
            [planId, tenantId]
        );

        this.logger.log(`Plan ${plan.display_name} asignado al tenant ${tenantId}`);
        return { success: true, message: `Plan ${plan.display_name} asignado correctamente.` };
    }

    // ── ACTUALIZAR PLAN (solo SUPERADMIN) ─────────────────────────────────────
    async updatePlan(planId: string, data: {
        price_monthly?: number;
        price_yearly?: number;
        max_users?: number;
        max_products?: number;
        max_invoices_mo?: number;
        features?: string[];
    }) {
        await this.dataSource.query(
            `UPDATE plans SET
                price_monthly   = COALESCE($1, price_monthly),
                price_yearly    = COALESCE($2, price_yearly),
                max_users       = COALESCE($3, max_users),
                max_products    = COALESCE($4, max_products),
                max_invoices_mo = COALESCE($5, max_invoices_mo),
                features        = COALESCE($6::jsonb, features)
             WHERE id = $7`,
            [
                data.price_monthly    || null,
                data.price_yearly     || null,
                data.max_users        || null,
                data.max_products     || null,
                data.max_invoices_mo  || null,
                data.features         ? JSON.stringify(data.features) : null,
                planId,
            ]
        );
        return { success: true, message: 'Plan actualizado.' };
    }
}
