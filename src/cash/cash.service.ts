import { Injectable, Logger, InternalServerErrorException, BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CloseCashSessionDto } from './dto/close-cash-session.dto';

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
            await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

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
            await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

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

    // 3. Cerrar Caja Ciego (Blind Cash Close)
    // El cajero reporta lo que contó, el sistema calcula lo esperado después
    async closeBoxBlind(tenantId: string, dto: CloseCashSessionDto) {
        this.logger.log(`[Cierre Ciego] Iniciando cierre para tenant: ${tenantId}, session: ${dto.cash_session_id}`);
        
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Regla de Oro Multi-tenant
            await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

            // 1. Obtener la sesión de caja específica
            const [session] = await queryRunner.query(
                `SELECT id, tenant_id, opening_date, initial_amount, status 
                 FROM cash_sessions 
                 WHERE id = $1 AND tenant_id = $2 
                 FOR UPDATE`,
                [dto.cash_session_id, tenantId]
            );

            if (!session) {
                throw new NotFoundException('Sesión de caja no encontrada.');
            }

            if (session.status === 'CLOSED') {
                throw new BadRequestException('Esta sesión de caja ya fue cerrada.');
            }

            if (session.status !== 'OPEN') {
                throw new BadRequestException(`Estado de caja inválido: ${session.status}`);
            }

            // 2. Calcular el expected_amount_cash sumando ventas en efectivo del turno
            const [salesResult] = await queryRunner.query(
                `SELECT COALESCE(SUM(total_amount), 0) AS total_cash_sales
                 FROM invoices
                 WHERE tenant_id = $1
                   AND payment_method = 'EFECTIVO'
                   AND created_at >= $2`,
                [tenantId, session.opening_date]
            );

            const totalCashSales = Number(salesResult.total_cash_sales);
            const expectedAmountCash = Number(session.initial_amount) + totalCashSales;
            const reportedAmountCash = dto.reported_amount_cash;
            const difference = reportedAmountCash - expectedAmountCash;

            this.logger.log(`[Cierre Ciego] Monto inicial: ${session.initial_amount}, Ventas efectivo: ${totalCashSales}, Esperado: ${expectedAmountCash}, Reportado: ${reportedAmountCash}`);

            // 3. Actualizar la sesión con ambos valores (reportado y esperado)
            await queryRunner.query(
                `UPDATE cash_sessions 
                 SET closing_date = CURRENT_TIMESTAMP,
                     final_amount_cash = $1,
                     expected_amount_cash = $2,
                     difference = $3,
                     status = 'CLOSED',
                     notes = $4
                 WHERE id = $5 AND tenant_id = $6`,
                [
                    reportedAmountCash,
                    expectedAmountCash,
                    difference,
                    dto.notes || null,
                    dto.cash_session_id,
                    tenantId
                ]
            );

            await queryRunner.commitTransaction();

            // 4. Preparar mensaje de resultado
            let resultMessage = '✅ Caja cuadrada perfectamente.';
            if (difference > 0) {
                resultMessage = `⚠️ Caja cerrada. Sobrante: S/ ${difference.toFixed(2)}`;
            } else if (difference < 0) {
                resultMessage = `⚠️ Caja cerrada. Faltante: S/ ${Math.abs(difference).toFixed(2)}`;
            }

            return {
                success: true,
                message: resultMessage,
                data: {
                    cash_session_id: dto.cash_session_id,
                    initial_amount: Number(session.initial_amount),
                    total_cash_sales: totalCashSales,
                    expected_amount_cash: expectedAmountCash,
                    reported_amount_cash: reportedAmountCash,
                    difference: difference,
                    status: difference === 0 ? 'CUADRADO' : difference > 0 ? 'SOBRANTE' : 'FALTANTE'
                }
            };

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('[Cierre Ciego] Error:', error);
            
            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al procesar el cierre de caja.');
        } finally {
            await queryRunner.release();
        }
    }

    // 3b. Cerrar Caja Legacy (mantener compatibilidad)
    async closeBox(tenantId: string, finalAmountCash: number, notes: string = '') {
        this.logger.log(`Cerrando caja para el tenant: ${tenantId}`);
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            await queryRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

            // 1. Obtener la sesión activa
            const session = await queryRunner.query(
                `SELECT * FROM cash_sessions WHERE status = 'OPEN' LIMIT 1`
            );

            if (session.length === 0) {
                throw new BadRequestException('No hay ninguna caja abierta para cerrar.');
            }

            const activeBox = session[0];

            // Usar el nuevo método con DTO
            return await this.closeBoxBlind(tenantId, {
                cash_session_id: activeBox.id,
                reported_amount_cash: finalAmountCash,
                notes: notes
            });

        } catch (error) {
            await queryRunner.rollbackTransaction();
            this.logger.error('Error al cerrar caja:', error);
            
            if (error instanceof BadRequestException || error instanceof NotFoundException) {
                throw error;
            }
            throw new InternalServerErrorException('Error al procesar el cierre de caja');
        } finally {
            await queryRunner.release();
        }
    }
}