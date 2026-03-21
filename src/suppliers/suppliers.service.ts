import {
    Injectable, Logger,
    InternalServerErrorException,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SuppliersService {
    private readonly logger = new Logger(SuppliersService.name);

    constructor(private readonly dataSource: DataSource) {}

    // ── LISTAR PROVEEDORES ────────────────────────────────────────────────────
    async findAll(tenantId: string, onlyActive = false) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const suppliers = await queryRunner.query(
                `SELECT s.*,
                        COUNT(im.id)::int AS total_orders
                 FROM suppliers s
                 LEFT JOIN inventory_movements im ON im.supplier_id = s.id
                 WHERE s.tenant_id = $1
                   ${onlyActive ? 'AND s.active = true' : ''}
                 GROUP BY s.id
                 ORDER BY s.name ASC`,
                [tenantId]
            );
            await queryRunner.commitTransaction();
            return { success: true, data: suppliers };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error cargando proveedores.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── CREAR PROVEEDOR ───────────────────────────────────────────────────────
    async create(tenantId: string, data: {
        name: string;
        ruc?: string;
        contact_name?: string;
        email?: string;
        phone?: string;
        address?: string;
        notes?: string;
    }) {
        if (!data.name?.trim()) {
            throw new BadRequestException('El nombre del proveedor es requerido.');
        }
        if (data.ruc && data.ruc.length !== 11) {
            throw new BadRequestException('El RUC debe tener 11 dígitos.');
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            // Verificar RUC duplicado dentro del tenant
            if (data.ruc) {
                const existe = await queryRunner.query(
                    `SELECT id FROM suppliers WHERE ruc = $1 AND tenant_id = $2`,
                    [data.ruc, tenantId]
                );
                if (existe.length > 0) {
                    throw new BadRequestException(
                        'Ya existe un proveedor con ese RUC en tu sistema.'
                    );
                }
            }

            const [supplier] = await queryRunner.query(
                `INSERT INTO suppliers
                 (tenant_id, name, ruc, contact_name, email, phone, address, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 RETURNING *`,
                [tenantId, data.name.trim(), data.ruc || null,
                 data.contact_name || null, data.email || null,
                 data.phone || null, data.address || null, data.notes || null]
            );

            await queryRunner.commitTransaction();
            return { success: true, message: 'Proveedor registrado.', data: supplier };
        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            if (error instanceof BadRequestException) throw error;
            throw new InternalServerErrorException('Error creando proveedor.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── ACTUALIZAR PROVEEDOR ──────────────────────────────────────────────────
    async update(tenantId: string, supplierId: string, data: {
        name?: string;
        ruc?: string;
        contact_name?: string;
        email?: string;
        phone?: string;
        address?: string;
        notes?: string;
    }) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const result = await queryRunner.query(
                `UPDATE suppliers SET
                    name         = COALESCE($1, name),
                    ruc          = COALESCE($2, ruc),
                    contact_name = COALESCE($3, contact_name),
                    email        = COALESCE($4, email),
                    phone        = COALESCE($5, phone),
                    address      = COALESCE($6, address),
                    notes        = COALESCE($7, notes)
                 WHERE id = $8 AND tenant_id = $9
                 RETURNING id`,
                [data.name || null, data.ruc || null, data.contact_name || null,
                 data.email || null, data.phone || null, data.address || null,
                 data.notes || null, supplierId, tenantId]
            );
            if (!result.length) throw new NotFoundException('Proveedor no encontrado.');
            await queryRunner.commitTransaction();
            return { success: true, message: 'Proveedor actualizado.' };
        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            if (error instanceof NotFoundException) throw error;
            throw new InternalServerErrorException('Error actualizando proveedor.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── ACTIVAR / DESACTIVAR ──────────────────────────────────────────────────
    async toggleActive(tenantId: string, supplierId: string, active: boolean) {
        await this.dataSource.query(
            `UPDATE suppliers SET active = $1 WHERE id = $2 AND tenant_id = $3`,
            [active, supplierId, tenantId]
        );
        return {
            success: true,
            message: active ? 'Proveedor reactivado.' : 'Proveedor desactivado.',
        };
    }

    // ── HISTORIAL DE COMPRAS AL PROVEEDOR ─────────────────────────────────────
    async getPurchaseHistory(tenantId: string, supplierId: string) {
        const movements = await this.dataSource.query(
            `SELECT im.id, im.quantity, im.reason,
                    TO_CHAR(im.created_at, 'YYYY-MM-DD HH24:MI') AS fecha,
                    p.name AS product_name, p.unit_price
             FROM inventory_movements im
             JOIN products p ON im.product_id = p.id
             WHERE im.tenant_id = $1
               AND im.supplier_id = $2
               AND im.type = 'INPUT'
             ORDER BY im.created_at DESC
             LIMIT 50`,
            [tenantId, supplierId]
        );
        return { success: true, data: movements };
    }
}
