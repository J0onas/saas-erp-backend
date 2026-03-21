import {
    Injectable, Logger,
    InternalServerErrorException,
    BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class InventoryService {
    private readonly logger = new Logger(InventoryService.name);

    constructor(private readonly dataSource: DataSource) {}

    // ── REGISTRAR ENTRADA DE MERCANCÍA ────────────────────────────────────────
    async registerEntry(
        tenantId: string,
        data: {
            productId: string;
            quantity: number;
            reason?: string;
            supplierName?: string;
            purchaseCost?: number;
        }
    ) {
        if (!data.quantity || data.quantity <= 0) {
            throw new BadRequestException('La cantidad debe ser mayor a 0.');
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            // Verificar que el producto existe
            const [product] = await queryRunner.query(
                `SELECT id, name, stock_quantity FROM products
                 WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [data.productId, tenantId]
            );

            if (!product) {
                throw new BadRequestException('Producto no encontrado.');
            }

            // Actualizar stock
            await queryRunner.query(
                `UPDATE products
                 SET stock_quantity = stock_quantity + $1
                 WHERE id = $2 AND tenant_id = $3`,
                [data.quantity, data.productId, tenantId]
            );

            const razon = data.reason ||
                (data.supplierName
                    ? `Compra a ${data.supplierName}`
                    : 'Ingreso de mercancía');

            // Registrar movimiento
            await queryRunner.query(
                `INSERT INTO inventory_movements
                 (tenant_id, product_id, type, quantity, reason)
                 VALUES ($1, $2, 'INPUT', $3, $4)`,
                [tenantId, data.productId, data.quantity, razon]
            );

            // Stock resultante
            const [updated] = await queryRunner.query(
                `SELECT stock_quantity FROM products WHERE id = $1`, [data.productId]
            );

            await queryRunner.commitTransaction();

            return {
                success: true,
                message: `Se agregaron ${data.quantity} unidades a "${product.name}".`,
                productName: product.name,
                stockAnterior: Number(product.stock_quantity),
                stockActual: Number(updated.stock_quantity),
            };

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            if (error instanceof BadRequestException) throw error;
            throw new InternalServerErrorException(error.message);
        } finally {
            await queryRunner.release();
        }
    }

    // ── AJUSTE MANUAL DE INVENTARIO ───────────────────────────────────────────
    async registerAdjustment(
        tenantId: string,
        data: {
            productId: string;
            newStock: number;   // stock físico real contado
            reason: string;
        }
    ) {
        if (!data.reason || data.reason.trim().length < 5) {
            throw new BadRequestException(
                'La justificación del ajuste debe tener al menos 5 caracteres.'
            );
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            const [product] = await queryRunner.query(
                `SELECT id, name, stock_quantity FROM products
                 WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
                [data.productId, tenantId]
            );

            if (!product) throw new BadRequestException('Producto no encontrado.');

            const diferencia = data.newStock - Number(product.stock_quantity);
            const tipo = diferencia >= 0 ? 'ADJUST' : 'ADJUST';

            await queryRunner.query(
                `UPDATE products SET stock_quantity = $1
                 WHERE id = $2 AND tenant_id = $3`,
                [data.newStock, data.productId, tenantId]
            );

            await queryRunner.query(
                `INSERT INTO inventory_movements
                 (tenant_id, product_id, type, quantity, reason)
                 VALUES ($1, $2, $3, $4, $5)`,
                [tenantId, data.productId, tipo,
                 Math.abs(diferencia),
                 `Ajuste: ${data.reason} (${diferencia >= 0 ? '+' : ''}${diferencia})`]
            );

            await queryRunner.commitTransaction();

            return {
                success: true,
                message: `Stock de "${product.name}" ajustado a ${data.newStock} unidades.`,
                diferencia,
            };

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            if (error instanceof BadRequestException) throw error;
            throw new InternalServerErrorException(error.message);
        } finally {
            await queryRunner.release();
        }
    }

    // ── HISTORIAL DE MOVIMIENTOS POR PRODUCTO ─────────────────────────────────
    async getMovements(tenantId: string, productId?: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            const movements = await queryRunner.query(`
                SELECT
                    im.id,
                    im.type,
                    im.quantity,
                    im.reason,
                    TO_CHAR(im.created_at, 'YYYY-MM-DD HH24:MI') AS fecha,
                    p.name AS product_name
                FROM inventory_movements im
                JOIN products p ON im.product_id = p.id
                WHERE im.tenant_id = $1
                  ${productId ? 'AND im.product_id = $2' : ''}
                ORDER BY im.created_at DESC
                LIMIT 100
            `, productId ? [tenantId, productId] : [tenantId]);

            await queryRunner.commitTransaction();
            return { success: true, data: movements };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error obteniendo movimientos.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── PRODUCTOS CON STOCK BAJO ──────────────────────────────────────────────
    async getLowStock(tenantId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );

            const products = await queryRunner.query(`
                SELECT id, name, stock_quantity, min_stock, unit_price
                FROM products
                WHERE tenant_id = $1
                  AND stock_quantity <= COALESCE(min_stock, 5)
                ORDER BY stock_quantity ASC
            `, [tenantId]);

            await queryRunner.commitTransaction();
            return { success: true, data: products };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error obteniendo stock bajo.');
        } finally {
            await queryRunner.release();
        }
    }
}
