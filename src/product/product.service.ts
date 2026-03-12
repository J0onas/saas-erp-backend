import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class ProductService {
    private readonly logger = new Logger(ProductService.name);

    constructor(private readonly dataSource: DataSource) {}

    // --- EL BUSCADOR QUE YA TENÍAS (Para el POS) ---
    async searchProducts(searchTerm: string, tenantId: string) {
        this.logger.log(`Buscando producto '${searchTerm}' para el tenant: ${tenantId}`);
        
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction(); // Llave maestra RLS
        
        try {
            await queryRunner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
            
            // Buscamos hasta 5 coincidencias por nombre o código
            const result = await queryRunner.query(
                `SELECT id, code, name, unit_price 
                 FROM products 
                 WHERE name ILIKE $1 OR code ILIKE $1 
                 LIMIT 5`,
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

    // --- NUEVA FUNCIÓN: TRAER TODO EL ALMACÉN (Para la pantalla de Inventario) ---
    async findAll(tenantId: string) {
        this.logger.log(`Obteniendo todo el inventario para el tenant: ${tenantId}`);
        
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction(); // Llave maestra RLS
        
        try {
            await queryRunner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
            
            // EL TRUCO: Disfrazamos 'stock_quantity' como 'stock' para no romper el frontend
            const products = await queryRunner.query(
                `SELECT id, code, name, unit_price, stock_quantity as stock FROM products ORDER BY name ASC`
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
    
    // --- NUEVA FUNCIÓN: CREAR PRODUCTO MANUALMENTE ---
    async createProduct(data: { name: string; unit_price: number; stock: number }, tenantId: string) {
        this.logger.log(`Creando nuevo producto '${data.name}' para el tenant: ${tenantId}`);
        
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction(); 
        
        try {
            await queryRunner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
            
            // EL TRUCO: También disfrazamos el RETURNING para que el frontend no se asuste
            const result = await queryRunner.query(
                `INSERT INTO products (tenant_id, name, unit_price, stock_quantity) 
                 VALUES ($1, $2, $3, $4) RETURNING id, name, unit_price, stock_quantity as stock`,
                [tenantId, data.name, data.unit_price, data.stock]
            );
            
            await queryRunner.commitTransaction();
            return { success: true, message: 'Producto registrado exitosamente', data: result[0] };
            
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error creando producto:', error);
            throw new InternalServerErrorException('No se pudo registrar el producto.');
        } finally {
            await queryRunner.release();
        }
    }
}