import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
    constructor(
        private dataSource: DataSource,
        private jwtService: JwtService
    ) {}

    // ── LOGIN ─────────────────────────────────────────────────────────────────
    async login(loginDto: LoginDto) {
        const users = await this.dataSource.query(
            `SELECT id, tenant_id, email, password_hash, full_name
             FROM users WHERE email = $1`,
            [loginDto.email]
        );

        const user = users[0];
        if (!user) throw new UnauthorizedException('Credenciales incorrectas');

        const valid = await bcrypt.compare(loginDto.password, user.password_hash);
        if (!valid) throw new UnauthorizedException('Credenciales incorrectas');

        const payload = {
            sub: user.id,
            tenantId: user.tenant_id,
            email: user.email,
            name: user.full_name,
        };

        return {
            access_token: this.jwtService.sign(payload),
            message: 'Login exitoso',
            user: { email: user.email, name: user.full_name },
        };
    }

    // ── REGISTRO DE NUEVO TENANT (Onboarding) ─────────────────────────────────
    // Crea el tenant, el usuario admin y la configuración inicial.
    // El tenant empieza con 14 días de trial gratuito.
    async registerTenant(data: {
        businessName: string;
        ruc: string;
        email: string;
        password: string;
        fullName?: string;
    }) {
        // Validaciones básicas
        if (!data.ruc || data.ruc.length !== 11) {
            throw new BadRequestException('El RUC debe tener exactamente 11 dígitos.');
        }
        if (!data.email || !data.email.includes('@')) {
            throw new BadRequestException('El correo electrónico no es válido.');
        }
        if (!data.password || data.password.length < 6) {
            throw new BadRequestException('La contraseña debe tener al menos 6 caracteres.');
        }

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Verificar que el RUC no esté registrado
            const rucExiste = await queryRunner.query(
                `SELECT id FROM tenants WHERE ruc = $1`, [data.ruc]
            );
            if (rucExiste.length > 0) {
                throw new ConflictException('Este RUC ya está registrado en el sistema.');
            }

            // Verificar que el email no esté en uso
            const emailExiste = await queryRunner.query(
                `SELECT id FROM users WHERE email = $1`, [data.email]
            );
            if (emailExiste.length > 0) {
                throw new ConflictException('Este correo ya está registrado. Usa otro o inicia sesión.');
            }

            // Crear tenant con 14 días de trial
            const tenantResult = await queryRunner.query(
                `INSERT INTO tenants
                 (business_name, ruc, subscription_status, subscription_valid_until)
                 VALUES ($1, $2, 'TRIAL',
                         CURRENT_TIMESTAMP + INTERVAL '14 days')
                 RETURNING id`,
                [data.businessName, data.ruc]
            );
            const tenantId = tenantResult[0].id;

            // Crear configuración inicial de la empresa
            await queryRunner.query(
                `INSERT INTO company_settings (tenant_id, business_name, ruc, address, email)
                 VALUES ($1, $2, $3, '', $4)`,
                [tenantId, data.businessName, data.ruc, data.email]
            );

            // Crear usuario administrador (GERENTE)
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash(data.password, salt);

            await queryRunner.query(
                `INSERT INTO users (tenant_id, email, password_hash, full_name)
                 VALUES ($1, $2, $3, $4)`,
                [tenantId, data.email, hash, data.fullName || data.businessName]
            );

            await queryRunner.commitTransaction();

            // Generar JWT listo para usar
            const payload = {
                sub: tenantId, // temporal, se actualizará con el id real del usuario
                tenantId,
                email: data.email,
                name: data.fullName || data.businessName,
            };

            return {
                success: true,
                message: `¡Bienvenido! Tu cuenta fue creada con 14 días de prueba gratuita.`,
                access_token: this.jwtService.sign(payload),
                user: { email: data.email, name: data.fullName || data.businessName },
                trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
            };

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            // Re-lanzar errores de negocio sin envolverlos
            if (error instanceof ConflictException || error instanceof BadRequestException) {
                throw error;
            }
            throw new Error('Error interno al crear la cuenta. Intenta de nuevo.');
        } finally {
            await queryRunner.release();
        }
    }
}
