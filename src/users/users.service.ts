import {
    Injectable, Logger,
    InternalServerErrorException,
    ConflictException,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
    private readonly logger = new Logger(UsersService.name);

    constructor(private readonly dataSource: DataSource) {}

    // ── LISTAR USUARIOS DEL TENANT ────────────────────────────────────────────
    async findAll(tenantId: string) {
        const users = await this.dataSource.query(
            `SELECT id, email, full_name, role, created_at,
                    CASE WHEN active = false THEN false ELSE true END AS active
             FROM users
             WHERE tenant_id = $1
             ORDER BY
               CASE role
                 WHEN 'GERENTE'    THEN 1
                 WHEN 'CAJERO'     THEN 2
                 WHEN 'SUPERADMIN' THEN 0
               END, full_name ASC`,
            [tenantId]
        );
        return { success: true, data: users };
    }

    // ── INVITAR NUEVO USUARIO ─────────────────────────────────────────────────
    // Crea el usuario directamente con contraseña temporal.
    // En una versión futura se puede reemplazar por envío de email de invitación.
    async inviteUser(
        tenantId: string,
        data: { email: string; fullName: string; role: string; password: string }
    ) {
        if (!['GERENTE', 'CAJERO'].includes(data.role)) {
            throw new BadRequestException('Rol inválido. Usa GERENTE o CAJERO.');
        }

        const emailExiste = await this.dataSource.query(
            `SELECT id FROM users WHERE email = $1`, [data.email]
        );
        if (emailExiste.length > 0) {
            throw new ConflictException('Este correo ya está registrado en el sistema.');
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(data.password, salt);

        await this.dataSource.query(
            `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
             VALUES ($1, $2, $3, $4, $5)`,
            [tenantId, data.email, hash, data.fullName, data.role]
        );

        this.logger.log(`Usuario ${data.email} creado con rol ${data.role} en tenant ${tenantId}`);

        return {
            success: true,
            message: `Usuario ${data.email} creado correctamente con rol ${data.role}.`,
        };
    }

    // ── CAMBIAR ROL ───────────────────────────────────────────────────────────
    async updateRole(tenantId: string, userId: string, newRole: string) {
        if (!['GERENTE', 'CAJERO'].includes(newRole)) {
            throw new BadRequestException('Rol inválido.');
        }

        const result = await this.dataSource.query(
            `UPDATE users SET role = $1
             WHERE id = $2 AND tenant_id = $3
             RETURNING id`,
            [newRole, userId, tenantId]
        );

        if (result.length === 0) {
            throw new NotFoundException('Usuario no encontrado.');
        }

        return { success: true, message: `Rol actualizado a ${newRole}.` };
    }

    // ── ACTIVAR / DESACTIVAR ──────────────────────────────────────────────────
    async toggleActive(tenantId: string, userId: string, active: boolean) {
        // Verificar que no sea el único GERENTE activo
        if (!active) {
            const gerentes = await this.dataSource.query(
                `SELECT COUNT(*) AS total FROM users
                 WHERE tenant_id = $1 AND role = 'GERENTE'
                   AND (active IS NULL OR active = true)
                   AND id != $2`,
                [tenantId, userId]
            );
            if (parseInt(gerentes[0].total) === 0) {
                throw new BadRequestException(
                    'No puedes desactivar al único Gerente activo del negocio.'
                );
            }
        }

        await this.dataSource.query(
            `UPDATE users SET active = $1
             WHERE id = $2 AND tenant_id = $3`,
            [active, userId, tenantId]
        );

        return {
            success: true,
            message: active ? 'Usuario reactivado.' : 'Usuario desactivado.',
        };
    }
}
