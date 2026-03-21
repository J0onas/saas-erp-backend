import { SetMetadata } from '@nestjs/common';

export type UserRole = 'SUPERADMIN' | 'GERENTE' | 'CAJERO';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
