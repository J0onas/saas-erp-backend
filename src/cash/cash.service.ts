import { Injectable, Logger, InternalServerErrorException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class CashService {
    private readonly logger = new Logger(CashService.name);
    constructor(private readonly dataSource: DataSource) {}

    // 1. Abrir Caja
    async openBox(tenantId: string, userEmail: string, initialAmount: number) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);

            // Verificar si ya hay una caja abierta
            const activeSession = await queryRunner.query(
                `SELECT id FROM cash_sessions WHERE status = 'OPEN' LIMIT 1`
            );

            if (activeSession.length > 0) {
                throw new BadRequestException('Ya existe una sesión de caja abierta.');
            }

            await queryRunner.query(
                `INSERT INTO cash_sessions (tenant_id, opened_by, initial_amount, status) 
                 VALUES ($1, $2, $3, 'OPEN')`,
                [tenantId, userEmail, initialAmount]
            );

            await queryRunner.commitTransaction();
            return { success: true, message: 'Caja abierta correctamente' };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error al abrir caja:', error);
            throw error;
        } finally {
            await queryRunner.release();
        }
    }

    // 2. Obtener estado actual (Ventas acumuladas en el turno)
    async getActiveSession(tenantId: string) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);

            const session = await queryRunner.query(
                `SELECT * FROM cash_sessions WHERE status = 'OPEN' LIMIT 1`
            );

            if (session.length === 0) return { success: true, active: false };

            const activeBox = session[0];

            // SUMAR VENTAS EN EFECTIVO DESDE QUE SE ABRIÓ LA CAJA
            const sales = await queryRunner.query(
                `SELECT COALESCE(SUM(total_amount), 0) as total_cash 
                 FROM invoices 
                 WHERE tenant_id = $1 
                 AND payment_method = 'EFECTIVO' 
                 AND created_at >= $2`,
                [tenantId, activeBox.opening_date]
            );

            await queryRunner.commitTransaction();

            return { 
                success: true, 
                active: true, 
                data: {
                    ...activeBox,
                    sales_cash: Number(sales[0].total_cash),
                    expected_total: Number(activeBox.initial_amount) + Number(sales[0].total_cash)
                }
            };
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw new InternalServerErrorException('Error al consultar estado de caja');
        } finally {
            await queryRunner.release();
        }
    }
    // 3. Cerrar Caja (Cuadre de Turno)
    async closeBox(tenantId: string, finalAmountCash: number, notes: string = '') {
        this.logger.log(`Cerrando caja para el tenant: ${tenantId}`);
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(`SET LOCAL app.current_tenant = '${tenantId}'`);

            // 1. Obtener la sesión activa
            const session = await queryRunner.query(
                `SELECT * FROM cash_sessions WHERE status = 'OPEN' LIMIT 1`
            );

            if (session.length === 0) {
                throw new BadRequestException('No hay ninguna caja abierta para cerrar.');
            }

            const activeBox = session[0];

            // 2. Calcular todo el efectivo que entró hoy
            const sales = await queryRunner.query(
                `SELECT COALESCE(SUM(total_amount), 0) as total_cash 
                 FROM invoices 
                 WHERE tenant_id = $1 
                 AND payment_method = 'EFECTIVO' 
                 AND created_at >= $2`,
                [tenantId, activeBox.opening_date]
            );

            const expectedCash = Number(activeBox.initial_amount) + Number(sales[0].total_cash);

            // 3. Cerrar la sesión y guardar si faltó o sobró dinero
            await queryRunner.query(
                `UPDATE cash_sessions 
                 SET closing_date = CURRENT_TIMESTAMP, 
                     final_amount_cash = $1, 
                     expected_amount_cash = $2, 
                     status = 'CLOSED', 
                     notes = $3 
                 WHERE id = $4`,
                [finalAmountCash, expectedCash, notes, activeBox.id]
            );

            await queryRunner.commitTransaction();

            // Calculamos la diferencia para mostrarla en el mensaje
            const difference = finalAmountCash - expectedCash;
            let resultMessage = 'Caja cuadrada perfectamente.';
            if (difference > 0) resultMessage = `Caja cerrada. Sobran S/ ${difference.toFixed(2)}`;
            if (difference < 0) resultMessage = `Caja cerrada. Faltan S/ ${Math.abs(difference).toFixed(2)}`;

            return { 
                success: true, 
                message: resultMessage,
                data: { expected: expectedCash, counted: finalAmountCash, difference }
            };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error al cerrar caja:', error);
            throw new InternalServerErrorException('Error al procesar el cierre de caja');
        } finally {
            await queryRunner.release();
        }
    }
}