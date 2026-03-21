import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ProductService {
    private readonly logger = new Logger(ProductService.name);

    constructor(private readonly dataSource: DataSource) {}

    // ── BUSCADOR PARA EL POS (con código de barras) ───────────────────────────
    // Ahora busca también por barcode y sku, además de nombre
    async searchProducts(searchTerm: string, tenantId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const result = await queryRunner.query(
                `SELECT p.id, p.code, p.name, p.unit_price,
                        p.stock_quantity, p.barcode, p.sku,
                        c.name AS category_name, c.color AS category_color
                 FROM products p
                 LEFT JOIN categories c ON p.category_id = c.id
                 WHERE (p.name ILIKE $1 OR p.code ILIKE $1
                     OR p.barcode ILIKE $1 OR p.sku ILIKE $1)
                 ORDER BY p.name ASC
                 LIMIT 8`,
                [`%${searchTerm}%`]
            );
            await queryRunner.commitTransaction();
            return { success: true, data: result };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error buscando producto.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── BÚSQUEDA EXACTA POR CÓDIGO DE BARRAS ──────────────────────────────────
    // Usada por el lector de barras para agregar directamente al carrito
    async findByBarcode(barcode: string, tenantId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const [product] = await queryRunner.query(
                `SELECT p.id, p.name, p.unit_price, p.stock_quantity,
                        p.barcode, p.sku,
                        c.name AS category_name, c.color AS category_color
                 FROM products p
                 LEFT JOIN categories c ON p.category_id = c.id
                 WHERE (p.barcode = $1 OR p.sku = $1)`,
                [barcode]
            );
            await queryRunner.commitTransaction();
            return { success: !!product, data: product || null };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error buscando por código.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── LISTAR TODO EL INVENTARIO ─────────────────────────────────────────────
    async findAll(tenantId: string, categoryId?: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const products = await queryRunner.query(
                `SELECT p.id, p.code, p.name, p.unit_price,
                        p.stock_quantity, p.stock_quantity AS stock,
                        p.min_stock, p.barcode, p.sku,
                        p.category_id,
                        c.name  AS category_name,
                        c.color AS category_color
                 FROM products p
                 LEFT JOIN categories c ON p.category_id = c.id
                 WHERE p.tenant_id = $1
                   ${categoryId ? 'AND p.category_id = $2' : ''}
                 ORDER BY c.name ASC NULLS LAST, p.name ASC`,
                categoryId ? [tenantId, categoryId] : [tenantId]
            );
            await queryRunner.commitTransaction();
            return { success: true, data: products };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error cargando inventario.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── CREAR PRODUCTO ────────────────────────────────────────────────────────
    async createProduct(
        data: {
            name: string;
            unit_price: number;
            stock: number;
            barcode?: string;
            sku?: string;
            category_id?: string;
        },
        tenantId: string
    ) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const [result] = await queryRunner.query(
                `INSERT INTO products
                 (tenant_id, name, unit_price, stock_quantity, barcode, sku, category_id)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id, name, unit_price,
                           stock_quantity, stock_quantity AS stock,
                           barcode, sku, category_id`,
                [tenantId, data.name, data.unit_price, data.stock,
                 data.barcode || null, data.sku || null, data.category_id || null]
            );
            await queryRunner.commitTransaction();
            return { success: true, message: 'Producto registrado.', data: result };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('No se pudo registrar el producto.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── ACTUALIZAR PRODUCTO ───────────────────────────────────────────────────
    async updateProduct(
        productId: string,
        tenantId: string,
        data: {
            name?: string;
            unit_price?: number;
            barcode?: string;
            sku?: string;
            category_id?: string;
            min_stock?: number;
        }
    ) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            await queryRunner.query(
                `UPDATE products SET
                    name        = COALESCE($1, name),
                    unit_price  = COALESCE($2, unit_price),
                    barcode     = COALESCE($3, barcode),
                    sku         = COALESCE($4, sku),
                    category_id = COALESCE($5, category_id),
                    min_stock   = COALESCE($6, min_stock)
                 WHERE id = $7 AND tenant_id = $8`,
                [data.name || null, data.unit_price || null,
                 data.barcode || null, data.sku || null,
                 data.category_id || null, data.min_stock || null,
                 productId, tenantId]
            );
            await queryRunner.commitTransaction();
            return { success: true, message: 'Producto actualizado.' };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error actualizando producto.');
        } finally {
            await queryRunner.release();
        }
    }
}
