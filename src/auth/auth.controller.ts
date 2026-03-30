import { Controller, Post, Body, HttpCode, HttpStatus, Get, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto, VerifyTokenDto } from './dto/password-reset.dto';
import { VerifyEmailDto, ResendVerificationDto } from './dto/email-verification.dto';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    // ── LOGIN ─────────────────────────────────────────────────────────────────
    @Post('login')
    @HttpCode(HttpStatus.OK)
    async login(@Body() loginDto: LoginDto) {
        return await this.authService.login(loginDto);
    }

    // ── REGISTRO DE NUEVO TENANT ──────────────────────────────────────────────
    // POST /api/v1/auth/register-tenant
    // Body: { businessName, ruc, email, password, fullName? }
    @Post('register-tenant')
    @HttpCode(HttpStatus.CREATED)
    async registerTenant(
        @Body() body: {
            businessName: string;
            ruc: string;
            email: string;
            password: string;
            fullName?: string;
        }
    ) {
        return await this.authService.registerTenant(body);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ══ VERIFICACIÓN DE EMAIL ══════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════

    // GET /api/v1/auth/verify-email?token=xxx
    // Verifica el email del usuario
    @Get('verify-email')
    @HttpCode(HttpStatus.OK)
    async verifyEmail(@Query() query: VerifyEmailDto) {
        return await this.authService.verifyEmail(query.token);
    }

    // POST /api/v1/auth/resend-verification
    // Body: { email }
    // Reenvía el email de verificación
    @Post('resend-verification')
    @HttpCode(HttpStatus.OK)
    async resendVerification(@Body() body: ResendVerificationDto) {
        return await this.authService.resendVerificationEmail(body.email);
    }

    // GET /api/v1/auth/check-verification?email=xxx
    // Verifica si el email ya está verificado
    @Get('check-verification')
    @HttpCode(HttpStatus.OK)
    async checkVerification(@Query('email') email: string) {
        return await this.authService.checkEmailVerificationStatus(email);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // ══ RECUPERACIÓN DE CONTRASEÑA ════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════

    // POST /api/v1/auth/forgot-password
    // Body: { email }
    // Envía email con link de recuperación
    @Post('forgot-password')
    @HttpCode(HttpStatus.OK)
    async forgotPassword(@Body() body: ForgotPasswordDto) {
        return await this.authService.forgotPassword(body.email);
    }

    // GET /api/v1/auth/verify-reset-token?token=xxx
    // Verifica si el token es válido antes de mostrar el formulario
    @Get('verify-reset-token')
    @HttpCode(HttpStatus.OK)
    async verifyResetToken(@Query() query: VerifyTokenDto) {
        return await this.authService.verifyResetToken(query.token);
    }

    // POST /api/v1/auth/reset-password
    // Body: { token, password }
    // Actualiza la contraseña con un token válido
    @Post('reset-password')
    @HttpCode(HttpStatus.OK)
    async resetPassword(@Body() body: ResetPasswordDto) {
        return await this.authService.resetPassword(body.token, body.password);
    }
}
