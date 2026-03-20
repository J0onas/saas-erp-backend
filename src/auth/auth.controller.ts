import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

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
}
