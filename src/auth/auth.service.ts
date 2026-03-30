import {
    Injectable, UnauthorizedException,
    ConflictException, BadRequestException,
    Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { LoginDto } from './dto/login.dto';
import { EmailService } from '../email/email.service';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private dataSource: DataSource,
        private jwtService: JwtService,
        private emailService: EmailService,
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

    // ══════════════════════════════════════════════════════════════════════════
    // ══ RECUPERACIÓN DE CONTRASEÑA ════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════

    /**
     * Genera un token seguro de 64 caracteres hexadecimales
     */
    private generateSecureToken(): string {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Hashea el token para almacenarlo en la BD (no guardamos tokens en texto plano)
     */
    private hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    /**
     * Solicitar recuperación de contraseña
     * - Genera token seguro
     * - Guarda hash del token en BD con expiración de 1 hora
     * - Envía email con el link de recuperación
     */
    async forgotPassword(email: string): Promise<{ message: string }> {
        this.logger.log(`Solicitud de recuperación para: ${email}`);

        // Buscar usuario
        const users = await this.dataSource.query(
            `SELECT id, email, full_name FROM users WHERE email = $1`,
            [email.toLowerCase().trim()]
        );

        // Siempre retornamos éxito para no revelar si el email existe (seguridad)
        if (!users || users.length === 0) {
            this.logger.warn(`Email no encontrado: ${email} (respondemos éxito por seguridad)`);
            return { message: 'Si el correo existe, recibirás las instrucciones.' };
        }

        const user = users[0];

        // Generar token seguro
        const rawToken = this.generateSecureToken();
        const hashedToken = this.hashToken(rawToken);

        // Invalidar tokens anteriores del usuario
        await this.dataSource.query(
            `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
            [user.id]
        );

        // Guardar nuevo token con expiración de 1 hora
        await this.dataSource.query(
            `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
             VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
            [user.id, hashedToken]
        );

        // Enviar email (en segundo plano, no bloqueamos la respuesta)
        this.emailService.sendPasswordResetEmail(
            user.email,
            user.full_name || 'Usuario',
            rawToken
        ).catch(err => {
            this.logger.error(`Error enviando email de recuperación: ${err.message}`);
        });

        this.logger.log(`Token de recuperación generado para: ${email}`);
        return { message: 'Si el correo existe, recibirás las instrucciones.' };
    }

    /**
     * Verificar si un token de recuperación es válido
     */
    async verifyResetToken(token: string): Promise<{ valid: boolean; email?: string }> {
        const hashedToken = this.hashToken(token);

        const results = await this.dataSource.query(
            `SELECT prt.id, prt.user_id, prt.expires_at, prt.used, u.email, u.full_name
             FROM password_reset_tokens prt
             JOIN users u ON u.id = prt.user_id
             WHERE prt.token_hash = $1`,
            [hashedToken]
        );

        if (!results || results.length === 0) {
            return { valid: false };
        }

        const tokenRecord = results[0];

        // Verificar si ya fue usado
        if (tokenRecord.used) {
            return { valid: false };
        }

        // Verificar si expiró
        if (new Date(tokenRecord.expires_at) < new Date()) {
            return { valid: false };
        }

        return { 
            valid: true, 
            email: tokenRecord.email 
        };
    }

    /**
     * Restablecer contraseña con token válido
     */
    async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
        if (!newPassword || newPassword.length < 6) {
            throw new BadRequestException('La contraseña debe tener al menos 6 caracteres.');
        }

        const hashedToken = this.hashToken(token);

        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        try {
            // Buscar y validar token
            const results = await queryRunner.query(
                `SELECT prt.id, prt.user_id, prt.expires_at, prt.used, u.email, u.full_name
                 FROM password_reset_tokens prt
                 JOIN users u ON u.id = prt.user_id
                 WHERE prt.token_hash = $1
                 FOR UPDATE`,
                [hashedToken]
            );

            if (!results || results.length === 0) {
                throw new BadRequestException('El enlace de recuperación no es válido.');
            }

            const tokenRecord = results[0];

            // Verificar si ya fue usado
            if (tokenRecord.used) {
                throw new BadRequestException('Este enlace ya fue utilizado. Solicita uno nuevo.');
            }

            // Verificar si expiró
            if (new Date(tokenRecord.expires_at) < new Date()) {
                throw new BadRequestException('El enlace ha expirado. Solicita uno nuevo.');
            }

            // Hashear nueva contraseña
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(newPassword, salt);

            // Actualizar contraseña del usuario
            await queryRunner.query(
                `UPDATE users SET password_hash = $1 WHERE id = $2`,
                [passwordHash, tokenRecord.user_id]
            );

            // Marcar token como usado
            await queryRunner.query(
                `UPDATE password_reset_tokens SET used = true, used_at = NOW() WHERE id = $1`,
                [tokenRecord.id]
            );

            // Invalidar todos los demás tokens del usuario
            await queryRunner.query(
                `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND id != $2`,
                [tokenRecord.user_id, tokenRecord.id]
            );

            await queryRunner.commitTransaction();

            // Enviar email de confirmación (en segundo plano)
            this.emailService.sendPasswordChangedEmail(
                tokenRecord.email,
                tokenRecord.full_name || 'Usuario'
            ).catch(err => {
                this.logger.error(`Error enviando confirmación de cambio: ${err.message}`);
            });

            this.logger.log(`Contraseña actualizada para: ${tokenRecord.email}`);
            return { message: 'Tu contraseña ha sido actualizada exitosamente.' };

        } catch (error: any) {
            await queryRunner.rollbackTransaction();
            if (error instanceof BadRequestException) throw error;
            this.logger.error(`Error en resetPassword: ${error.message}`);
            throw new BadRequestException('Error al actualizar la contraseña. Intenta de nuevo.');
        } finally {
            await queryRunner.release();
        }
    }
}
