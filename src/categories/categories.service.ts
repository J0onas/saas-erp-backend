import {
    Injectable, Logger,
    InternalServerErrorException,
    BadRequestException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class CategoriesService {
    private readonly logger = new Logger(CategoriesService.name);

    constructor(private readonly dataSource: DataSource) {}

    // ── LISTAR CATEGORÍAS ─────────────────────────────────────────────────────
    async findAll(tenantId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const cats = await queryRunner.query(
                `SELECT c.id, c.name, c.color,
                        COUNT(p.id)::int AS product_count
                 FROM categories c
                 LEFT JOIN products p ON p.category_id = c.id
                 WHERE c.tenant_id = $1
                 GROUP BY c.id, c.name, c.color
                 ORDER BY c.name ASC`,
                [tenantId]
            );
            await queryRunner.commitTransaction();
            return { success: true, data: cats };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error cargando categorías.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── CREAR CATEGORÍA ───────────────────────────────────────────────────────
    async create(tenantId: string, data: { name: string; color?: string }) {
        if (!data.name?.trim()) {
            throw new BadRequestException('El nombre de la categoría es requerido.');
        }
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            const [cat] = await queryRunner.query(
                `INSERT INTO categories (tenant_id, name, color)
                 VALUES ($1, $2, $3)
                 RETURNING id, name, color`,
                [tenantId, data.name.trim(), data.color || '#3b82f6']
            );
            await queryRunner.commitTransaction();
            return { success: true, message: 'Categoría creada.', data: cat };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error creando categoría.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── ACTUALIZAR CATEGORÍA ──────────────────────────────────────────────────
    async update(
        tenantId: string,
        categoryId: string,
        data: { name?: string; color?: string }
    ) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            await queryRunner.query(
                `UPDATE categories
                 SET name  = COALESCE($1, name),
                     color = COALESCE($2, color)
                 WHERE id = $3 AND tenant_id = $4`,
                [data.name || null, data.color || null, categoryId, tenantId]
            );
            await queryRunner.commitTransaction();
            return { success: true, message: 'Categoría actualizada.' };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error actualizando categoría.');
        } finally {
            await queryRunner.release();
        }
    }

    // ── ELIMINAR CATEGORÍA ────────────────────────────────────────────────────
    async remove(tenantId: string, categoryId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        try {
            await queryRunner.query(
                `SELECT set_config('app.current_tenant', $1, true)`, [tenantId]
            );
            // Desasignar productos antes de eliminar
            await queryRunner.query(
                `UPDATE products SET category_id = NULL
                 WHERE category_id = $1 AND tenant_id = $2`,
                [categoryId, tenantId]
            );
            await queryRunner.query(
                `DELETE FROM categories WHERE id = $1 AND tenant_id = $2`,
                [categoryId, tenantId]
            );
            await queryRunner.commitTransaction();
            return { success: true, message: 'Categoría eliminada.' };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error eliminando categoría.');
        } finally {
            await queryRunner.release();
        }
    }
}
