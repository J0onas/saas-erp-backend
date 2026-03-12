import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tenantId = request.user?.tenantId; // Obtenemos el ID del JWT (AuthGuard debe ejecutarse primero)

    if (!tenantId) {
      return false; // Sin tenantId, no entra.
    }

    // Buscamos el estado exacto de la suscripción en la Base de Datos
    const result = await this.dataSource.query(
      `SELECT subscription_status, subscription_valid_until FROM tenants WHERE id = $1`,
      [tenantId]
    );

    if (result.length === 0) {
      throw new HttpException('Empresa no encontrada.', HttpStatus.UNAUTHORIZED);
    }

    const tenant = result[0];
    const now = new Date();

    // LÓGICA DE BLOQUEO: Si no está activo, o si la fecha de hoy superó su fecha de vencimiento
    if (tenant.subscription_status !== 'ACTIVE' || new Date(tenant.subscription_valid_until) < now) {
      // Lanzamos un error 402 PAYMENT REQUIRED (Es el estándar HTTP para cobros en SaaS)
      throw new HttpException({
        success: false,
        error: 'PAYMENT_REQUIRED',
        message: 'Tu suscripción ha vencido. Por favor, renueva tu plan para seguir facturando.'
      }, HttpStatus.PAYMENT_REQUIRED);
    }

    return true; // Si todo está bien, lo dejamos pasar a facturar
  }
}