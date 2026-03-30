import { Controller, Post, Body, HttpCode, HttpStatus, Get, Query } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, ResetPasswordDto, VerifyTokenDto } from './dto/password-reset.dto';

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
