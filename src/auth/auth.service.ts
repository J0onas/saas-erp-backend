import {
    Injectable, UnauthorizedException,
    ConflictException, BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
    constructor(
        private dataSource: DataSource,
        private jwtService: JwtService,
    ) {}

    // ── LOGIN ─────────────────────────────────────────────────────────────────
    async login(loginDto: LoginDto) {
        const users = await this.dataSource.query(
            `SELECT id, tenant_id, email, password_hash, full_name, role
             FROM users WHERE email = $1`,
            [loginDto.email]
        );

        const user = users[0];
        if (!user) throw new UnauthorizedException('Credenciales incorrectas');

        const valid = await bcrypt.compare(loginDto.password, user.password_hash);
        if (!valid) throw new UnauthorizedException('Credenciales incorrectas');

        // ← role incluido en el JWT
        const payload = {
            sub: user.id,
            tenantId: user.tenant_id,
            email: user.email,
            name: user.full_name,
            role: user.role || 'CAJERO',
        };

        return {
            access_token: this.jwtService.sign(payload),
            message: 'Login exitoso',
            user: {
                email: user.email,
                name: user.full_name,
                role: user.role || 'CAJERO',
            },
        };
    }

    // ── REGISTRO DE NUEVO TENANT ──────────────────────────────────────────────
    async registerTenant(data: {
        businessName: string;
        ruc?: string;
        email: string;
        password: string;
        fullName?: string;
    }) {
        if (!data.email?.includes('@')) {
            throw new BadRequestException('El correo electrónico no es válido.');
        }
        if (!data.password || data.password.length < 6) {
            throw new BadRequestException('La contraseña debe tener al menos 6 caracteres.');
        }
        if (data.ruc && data.ruc.length !== 11) {
            throw new BadRequestException('El RUC debe tener exactamente 11 dígitos.');
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Verificar RUC duplicado (solo si se proporcionó)
            if (data.ruc) {
                const rucExiste = await queryRunner.query(
                    `SELECT id FROM tenants WHERE ruc = $1`, [data.ruc]
                );
                if (rucExiste.length > 0) {
                    throw new ConflictException('Este RUC ya está registrado.');
                }
            }

            // Verificar email duplicado
            const emailExiste = await queryRunner.query(
                `SELECT id FROM users WHERE email = $1`, [data.email]
            );
            if (emailExiste.length > 0) {
                throw new ConflictException(
                    'Este correo ya está registrado. Usa otro o inicia sesión.'
                );
            }

            // RUC temporal si no se proporcionó
            const rucFinal = data.ruc || `TEST${Date.now().toString().slice(-7)}`;

            // Crear tenant con 14 días de trial
            const [tenant] = await queryRunner.query(
                `INSERT INTO tenants
                 (business_name, ruc, subscription_status, subscription_valid_until)
                 VALUES ($1, $2, 'TRIAL', CURRENT_TIMESTAMP + INTERVAL '14 days')
                 RETURNING id`,
                [data.businessName, rucFinal]
            );
            const tenantId = tenant.id;

            // Configuración inicial de la empresa
            await queryRunner.query(
                `INSERT INTO company_settings (tenant_id, business_name, ruc, address, email)
                 VALUES ($1, $2, $3, '', $4)`,
                [tenantId, data.businessName, rucFinal, data.email]
            );

            // Crear usuario admin con rol GERENTE
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(data.password, salt);
            const fullName = data.fullName || data.businessName;

            const [newUser] = await queryRunner.query(
                `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
                 VALUES ($1, $2, $3, $4, 'GERENTE')
                 RETURNING id`,
                [tenantId, data.email, hash, fullName]
            );

            await queryRunner.commitTransaction();

            const payload = {
                sub: newUser.id,
                tenantId,
                email: data.email,
                name: fullName,
                role: 'GERENTE',
            };

            return {
                success: true,
                message: '¡Bienvenido! Tu cuenta fue creada con 14 días de prueba gratuita.',
                access_token: this.jwtService.sign(payload),
                user: { email: data.email, name: fullName, role: 'GERENTE' },
                trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            };

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            if (
                error instanceof ConflictException ||
                error instanceof BadRequestException
            ) throw error;
            throw new Error('Error interno al crear la cuenta. Intenta de nuevo.');
        } finally {
            await queryRunner.release();
        }
    }
}
