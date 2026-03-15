import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ProductService {
    private readonly logger = new Logger(ProductService.name);

    constructor(private readonly dataSource: DataSource) {}

    // ── BUSCADOR PARA EL POS ─────────────────────────────────────────────────
    // FIX: ahora devuelve stock_quantity para que el frontend pueda bloquear
    // productos agotados antes de agregarlos al carrito.
    async searchProducts(searchTerm: string, tenantId: string) {
        this.logger.log(`Buscando '${searchTerm}' para tenant: ${tenantId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`,
                [tenantId]
            );

            const result = await queryRunner.query(
                `SELECT id, code, name, unit_price, stock_quantity
                 FROM products
                 WHERE (name ILIKE $1 OR code ILIKE $1)
                 ORDER BY name ASC
                 LIMIT 8`,
                [`%${searchTerm}%`]
            );

            await queryRunner.commitTransaction();
            return { success: true, data: result };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error buscando producto:', error);
            throw new InternalServerErrorException('Error en la base de datos');
        } finally {
            await queryRunner.release();
        }
    }

    // ── TODO EL ALMACÉN (pantalla Inventario) ────────────────────────────────
    async findAll(tenantId: string) {
        this.logger.log(`Cargando inventario para tenant: ${tenantId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`,
                [tenantId]
            );

            const products = await queryRunner.query(
                `SELECT id, code, name, unit_price,
                        stock_quantity,
                        stock_quantity AS stock
                 FROM products
                 ORDER BY name ASC`
            );

            await queryRunner.commitTransaction();
            return { success: true, data: products };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error obteniendo productos:', error);
            throw new InternalServerErrorException('Error al cargar el inventario');
        } finally {
            await queryRunner.release();
        }
    }

    // ── CREAR PRODUCTO ────────────────────────────────────────────────────────
    async createProduct(
        data: { name: string; unit_price: number; stock: number },
        tenantId: string
    ) {
        this.logger.log(`Creando producto '${data.name}' para tenant: ${tenantId}`);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`,
                [tenantId]
            );

            const result = await queryRunner.query(
                `INSERT INTO products (tenant_id, name, unit_price, stock_quantity)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, name, unit_price,
                           stock_quantity,
                           stock_quantity AS stock`,
                [tenantId, data.name, data.unit_price, data.stock]
            );

            await queryRunner.commitTransaction();
            return {
                success: true,
                message: 'Producto registrado exitosamente',
                data: result[0],
            };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error creando producto:', error);
            throw new InternalServerErrorException('No se pudo registrar el producto.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── VALIDAR STOCK (usado internamente por InvoiceService) ─────────────────
    // Retorna true si todos los ítems tienen suficiente stock.
    // Lanza excepción con el nombre del producto agotado si no alcanza.
    async validateStock(
        items: Array<{ productId: string; quantity: number; description: string }>,
        tenantId: string,
        queryRunner: any
    ): Promise<void> {
        for (const item of items) {
            if (!item.productId) continue;

            const result = await queryRunner.query(
                `SELECT name, stock_quantity FROM products WHERE id = $1 AND tenant_id = $2`,
                [item.productId, tenantId]
            );

            if (result.length === 0) continue;

            const producto = result[0];
            const stockActual = Number(producto.stock_quantity);

            if (stockActual < item.quantity) {
                throw new Error(
                    `Stock insuficiente para "${producto.name}". ` +
                    `Disponible: ${stockActual}, solicitado: ${item.quantity}.`
                );
            }
        }
    }
}
