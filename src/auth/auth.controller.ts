import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  // NUEVA RUTA DE REGISTRO
  @Post('register')
  register(@Body() loginDto: LoginDto) {
    return this.authService.register(loginDto);
  }
}