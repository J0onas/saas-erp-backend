import { Controller, Post, Body, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Response } from 'express'; // <-- FIX 1: Agregamos la palabra "type" aquí
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto, 
    @Res({ passthrough: true }) res: Response
  ) {
    const result = await this.authService.login(loginDto);

    // --- FIX BUG #5: JWT en Cookie httpOnly ---
    res.cookie('token', result.access_token, {
      httpOnly: true, // El frontend NO puede leerla con JavaScript (Adiós XSS)
      secure: true,   // Obligatorio para cross-domain
      sameSite: 'none', // Permite que la cookie viaje de Render a Vercel
      maxAge: 1000 * 60 * 60 * 24 // 1 día
    });

    // FIX 2: Decodificamos el JWT aquí mismo para extraer los datos del usuario
    // sin tener que modificar auth.service.ts
    const payload = JSON.parse(Buffer.from(result.access_token.split('.')[1], 'base64').toString());

    // Puedes dejar lo de la cookie, pero agregamos el access_token al return
    return { 
      success: true, 
      message: 'Login exitoso',
      access_token: result.access_token, // <-- ¡VOLVEMOS A ENVIAR EL TOKEN!
      user: {
        id: payload.sub,
        email: payload.email,
        tenantId: payload.tenantId,
        role: payload.role || 'CAJERO' 
      } 
    };
  }
}