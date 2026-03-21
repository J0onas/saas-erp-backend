import {
    Injectable, CanActivate, ExecutionContext,
    ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, UserRole } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
    constructor(private reflector: Reflector) {}

    canActivate(context: ExecutionContext): boolean {
        // Leer los roles requeridos del decorador @Roles(...)
        const rolesRequeridos = this.reflector.getAllAndOverride<UserRole[]>(
            ROLES_KEY,
            [context.getHandler(), context.getClass()]
        );

        // Si la ruta no tiene @Roles, cualquier usuario autenticado puede acceder
        if (!rolesRequeridos || rolesRequeridos.length === 0) {
            return true;
        }

        const { user } = context.switchToHttp().getRequest();

        // SUPERADMIN tiene acceso a todo sin excepción
        if (user?.role === 'SUPERADMIN') return true;

        const tieneRol = rolesRequeridos.some((rol) => user?.role === rol);

        if (!tieneRol) {
            throw new ForbiddenException(
                `Acceso denegado. Se requiere rol: ${rolesRequeridos.join(' o ')}.`
            );
        }

        return true;
    }
}
