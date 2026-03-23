import {
    Injectable, Logger,
    InternalServerErrorException,
    BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class BranchesService {
    private readonly logger = new Logger(BranchesService.name);

    constructor(private readonly dataSource: DataSource) {}

    // ── LISTAR SUCURSALES ─────────────────────────────────────────────────────
    async findAll(tenantId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const branches = await queryRunner.query(`
                SELECT
                    b.id, b.name, b.address, b.phone,
                    b.is_main, b.is_active,
                    TO_CHAR(b.created_at, 'YYYY-MM-DD') AS created_at,
                    COUNT(DISTINCT u.id)::int  AS total_users,
                    COUNT(DISTINCT i.id)::int  AS total_invoices,
                    COALESCE(SUM(i.total_amount), 0) AS total_revenue
                FROM branches b
                LEFT JOIN users    u ON u.branch_id = b.id
                LEFT JOIN invoices i ON i.branch_id = b.id
                WHERE b.tenant_id = $1
                GROUP BY b.id, b.name, b.address, b.phone, b.is_main, b.is_active, b.created_at
                ORDER BY b.is_main DESC, b.name ASC
            `, [tenantId]);
            await queryRunner.commitTransaction();
            return { success: true, data: branches };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error cargando sucursales.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── CREAR SUCURSAL ────────────────────────────────────────────────────────
    async create(tenantId: string, data: {
        name: string;
        address?: string;
        phone?: string;
    }) {
        if (!data.name?.trim()) {
            throw new BadRequestException('El nombre de la sucursal es requerido.');
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            const [branch] = await queryRunner.query(
                `INSERT INTO branches (tenant_id, name, address, phone, is_main)
                 VALUES ($1, $2, $3, $4, false)
                 RETURNING *`,
                [tenantId, data.name.trim(), data.address || null, data.phone || null]
            );

            // Inicializar stock en 0 para todos los productos existentes
            await queryRunner.query(`
                INSERT INTO branch_stock (branch_id, product_id, tenant_id, quantity)
                SELECT $1, p.id, p.tenant_id, 0
                FROM products p
                WHERE p.tenant_id = $2
                ON CONFLICT (branch_id, product_id) DO NOTHING
            `, [branch.id, tenantId]);

            await queryRunner.commitTransaction();
            this.logger.log(`Sucursal "${data.name}" creada para tenant ${tenantId}`);
            return { success: true, message: 'Sucursal creada correctamente.', data: branch };
        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            if (error instanceof BadRequestException) throw error;
            throw new InternalServerErrorException('Error creando sucursal.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── ACTUALIZAR SUCURSAL ───────────────────────────────────────────────────
    async update(tenantId: string, branchId: string, data: {
        name?: string;
        address?: string;
        phone?: string;
        is_active?: boolean;
    }) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            await queryRunner.query(`
                UPDATE branches SET
                    name      = COALESCE($1, name),
                    address   = COALESCE($2, address),
                    phone     = COALESCE($3, phone),
                    is_active = COALESCE($4, is_active)
                WHERE id = $5 AND tenant_id = $6
            `, [data.name || null, data.address || null, data.phone || null,
                data.is_active ?? null, branchId, tenantId]);
            await queryRunner.commitTransaction();
            return { success: true, message: 'Sucursal actualizada.' };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error actualizando sucursal.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── STOCK DE UNA SUCURSAL ─────────────────────────────────────────────────
    async getBranchStock(tenantId: string, branchId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const stock = await queryRunner.query(`
                SELECT
                    p.id, p.name, p.unit_price, p.barcode, p.sku,
                    COALESCE(bs.quantity, 0) AS branch_quantity,
                    p.stock_quantity         AS total_quantity,
                    c.name AS category_name
                FROM products p
                LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = $2
                LEFT JOIN categories c ON p.category_id = c.id
                WHERE p.tenant_id = $1
                ORDER BY p.name ASC
            `, [tenantId, branchId]);
            await queryRunner.commitTransaction();
            return { success: true, data: stock };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error cargando stock de sucursal.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── TRANSFERIR STOCK ENTRE SUCURSALES ─────────────────────────────────────
    async transferStock(tenantId: string, data: {
        fromBranchId: string;
        toBranchId: string;
        productId: string;
        quantity: number;
    }) {
        if (data.quantity <= 0) {
            throw new BadRequestException('La cantidad debe ser mayor a 0.');
        }
        if (data.fromBranchId === data.toBranchId) {
            throw new BadRequestException('Las sucursales de origen y destino deben ser diferentes.');
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            // Verificar stock disponible en sucursal origen
            const [fromStock] = await queryRunner.query(`
                SELECT COALESCE(bs.quantity, 0) AS quantity, p.name
                FROM products p
                LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = $1
                WHERE p.id = $2 AND p.tenant_id = $3
                FOR UPDATE
            `, [data.fromBranchId, data.productId, tenantId]);

            if (!fromStock) throw new BadRequestException('Producto no encontrado.');

            if (Number(fromStock.quantity) < data.quantity) {
                throw new BadRequestException(
                    `Stock insuficiente en sucursal origen. ` +
                    `Disponible: ${fromStock.quantity}, solicitado: ${data.quantity}.`
                );
            }

            // Descontar de origen
            await queryRunner.query(`
                INSERT INTO branch_stock (branch_id, product_id, tenant_id, quantity)
                VALUES ($1, $2, $3, -$4)
                ON CONFLICT (branch_id, product_id)
                DO UPDATE SET quantity = branch_stock.quantity - $4,
                              updated_at = NOW()
            `, [data.fromBranchId, data.productId, tenantId, data.quantity]);

            // Agregar a destino
            await queryRunner.query(`
                INSERT INTO branch_stock (branch_id, product_id, tenant_id, quantity)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (branch_id, product_id)
                DO UPDATE SET quantity = branch_stock.quantity + $4,
                              updated_at = NOW()
            `, [data.toBranchId, data.productId, tenantId, data.quantity]);

            await queryRunner.commitTransaction();
            return {
                success: true,
                message: `${data.quantity} unidades de "${fromStock.name}" transferidas correctamente.`,
            };
        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            if (error instanceof BadRequestException) throw error;
            throw new InternalServerErrorException(error.message);
        } finally {
            await queryRunner.release();
        }
    }

    // ── MÉTRICAS POR SUCURSAL ─────────────────────────────────────────────────
    async getBranchStats(tenantId: string, branchId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            const [stats] = await queryRunner.query(`
                SELECT
                    COUNT(i.id)::int                         AS total_invoices,
                    COALESCE(SUM(i.total_amount), 0)         AS total_revenue,
                    COALESCE(AVG(i.total_amount), 0)         AS avg_ticket
                FROM invoices i
                WHERE i.tenant_id = $1 AND i.branch_id = $2
            `, [tenantId, branchId]);

            const lastDays = await queryRunner.query(`
                SELECT
                    TO_CHAR(issue_date, 'DD/MM') AS date,
                    COALESCE(SUM(total_amount), 0) AS total
                FROM invoices
                WHERE tenant_id = $1 AND branch_id = $2
                  AND issue_date >= CURRENT_DATE - INTERVAL '6 days'
                GROUP BY issue_date
                ORDER BY issue_date ASC
            `, [tenantId, branchId]);

            await queryRunner.commitTransaction();
            return { success: true, data: { stats, lastDays } };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error cargando stats de sucursal.');
        } finally {
            await queryRunner.release();
        }
    }
}
