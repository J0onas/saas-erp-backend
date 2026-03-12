import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SettingsService {
    private readonly logger = new Logger(SettingsService.name);

    constructor(private readonly dataSource: DataSource) {}

    // 1. Obtener la configuración actual
    // 1. Obtener la configuración actual (¡CORREGIDO CON LA LLAVE MAESTRA!)
    async getSettings(tenantId: string) {
        this.logger.log(`Obteniendo configuración para el tenant: ${tenantId}`);
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        
        // --- ¡LA LLAVE MAESTRA PARA PODER LEER! ---
        await queryRunner.startTransaction(); 
        // -----------------------------------------
        
        try {
            await queryRunner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
            
            const result = await queryRunner.query(
                `SELECT business_name, ruc, address, email FROM company_settings WHERE tenant_id = $1`,
                [tenantId]
            );
            
            // --- CERRAMOS LA CAJA FUERTE ---
            await queryRunner.commitTransaction();
            
            // Si es un cliente nuevo y no ha configurado nada
            if (result.length === 0) {
                return { 
                    success: true, 
                    data: { business_name: '', ruc: '', address: '', email: '' } 
                };
            }
            
            return { success: true, data: result[0] };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error obteniendo configuración:', error);
            throw new InternalServerErrorException('Error al cargar datos de la empresa');
        } finally {
            await queryRunner.release();
        }
    }

    // 2. Guardar o actualizar la configuración (UPSERT)
    async updateSettings(tenantId: string, data: { business_name: string; ruc: string; address: string; email: string }) {
        this.logger.log(`Actualizando configuración del tenant: ${tenantId}`);
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction(); // Llave maestra
        
        try {
            await queryRunner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
            
            // Magia de PostgreSQL: Si el tenant_id no existe, inserta. Si ya existe, actualiza.
            await queryRunner.query(
                `INSERT INTO company_settings (tenant_id, business_name, ruc, address, email) 
                 VALUES ($1, $2, $3, $4, $5) 
                 ON CONFLICT (tenant_id) 
                 DO UPDATE SET 
                    business_name = EXCLUDED.business_name, 
                    ruc = EXCLUDED.ruc, 
                    address = EXCLUDED.address, 
                    email = EXCLUDED.email`,
                [tenantId, data.business_name, data.ruc, data.address, data.email]
            );
            
            await queryRunner.commitTransaction();
            return { success: true, message: 'Configuración guardada exitosamente' };
            
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error guardando configuración:', error);
            throw new InternalServerErrorException('Error al guardar datos de la empresa');
        } finally {
            await queryRunner.release();
        }
    }
}