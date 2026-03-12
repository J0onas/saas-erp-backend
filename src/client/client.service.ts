import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class ClientService {
    private readonly logger = new Logger(ClientService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly httpService: HttpService
    ) {}

    async findByDocument(documentNumber: string, tenantId: string) {
        this.logger.log(`Buscando RUC/DNI ${documentNumber} para el tenant: ${tenantId}`);
        
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();
        
        try {
            await queryRunner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);
            
            // 1. Buscamos primero en nuestra bóveda local
            const result = await queryRunner.query(
                `SELECT document_number, full_name, address FROM clients WHERE document_number = $1 LIMIT 1`,
                [documentNumber]
            );
            
            await queryRunner.commitTransaction(); 
            
            if (result.length > 0) {
                this.logger.log('Cliente encontrado en BD local.');
                return { success: true, data: result[0] };
            } 
            
            // 2. Si no existe, SALIMOS A INTERNET DE VERDAD (SUNAT / RENIEC)
            this.logger.log('Cliente no encontrado localmente. Consultando API externa real...');
            
            let externalName = '';
            
            try {
                if (documentNumber.length === 8) {
                    // Consulta DNI real
                    const response = await lastValueFrom(
                        this.httpService.get(`https://api.apis.net.pe/v1/dni?numero=${documentNumber}`)
                    );
                    externalName = response.data.nombre;
                } else if (documentNumber.length === 11) {
                    // Consulta RUC real
                    const response = await lastValueFrom(
                        this.httpService.get(`https://api.apis.net.pe/v1/ruc?numero=${documentNumber}`)
                    );
                    externalName = response.data.nombre;
                } else {
                    return { success: false, message: 'Documento inválido' };
                }
            } catch (apiError) {
                this.logger.warn('La API externa no encontró el documento o está inactiva.');
                return { success: false, message: 'No se encontró en SUNAT/RENIEC' };
            }

            // Retornamos los datos reales extraídos de internet
            return { 
                success: true, 
                data: {
                    document_number: documentNumber,
                    full_name: externalName,
                    address: '-'
                } 
            };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error buscando cliente:', error);
            throw new InternalServerErrorException('Error en la base de datos');
        } finally {
            await queryRunner.release();
        }
    }
}