// ── plan.guard.ts ─────────────────────────────────────────────────────────────
// Guard que verifica límites del plan antes de crear recursos.
// Uso: @UsePlanLimit('products') antes del endpoint de crear producto.
//
// Ejemplo:
//   @UseGuards(AuthGuard('jwt'), PlanGuard)
//   @UsePlanLimit('products')
//   @Post()
//   async createProduct(...) { ... }

import {
    Injectable, CanActivate, ExecutionContext,
    ForbiddenException, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlansService } from './plans.service';

export const PLAN_LIMIT_KEY = 'plan_limit';
export const UsePlanLimit = (resource: 'users' | 'products' | 'invoices_mo') =>
    SetMetadata(PLAN_LIMIT_KEY, resource);

@Injectable()
export class PlanGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly plansService: PlansService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const resource = this.reflector.getAllAndOverride<string>(
            PLAN_LIMIT_KEY,
            [context.getHandler(), context.getClass()]
        );

        if (!resource) return true; // sin decorador = sin restricción

        const request  = context.switchToHttp().getRequest();
        const tenantId = request.user?.tenantId;
        if (!tenantId) return false;

        const check = await this.plansService.checkLimit(
            tenantId,
            resource as 'users' | 'products' | 'invoices_mo'
        );

        if (!check.allowed) {
            const resourceLabels: Record<string, string> = {
                users:       'usuarios',
                products:    'productos',
                invoices_mo: 'facturas este mes',
            };
            throw new ForbiddenException(
                `Has alcanzado el límite de tu plan ${check.planName}: ` +
                `${check.current}/${check.max} ${resourceLabels[resource]}. ` +
                `Actualiza tu plan para continuar.`
            );
        }

        return true;
    }
}
