import { Injectable, UnauthorizedException } from '@nestjs/common';
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

  async login(loginDto: LoginDto) {
    // 1. Buscamos al usuario en la BD por su email
    const users = await this.dataSource.query(
      `SELECT id, tenant_id, email, password_hash, full_name FROM users WHERE email = $1`,
      [loginDto.email]
    );

    const user = users[0];

    // 2. Si el correo no existe, lanzamos error 401 (No Autorizado)
    if (!user) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    // 3. Comparamos la contraseña en texto plano con el Hash de la BD
    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password_hash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    // 4. ¡Magia! Generamos el Token JWT inyectando el tenant_id de forma oculta
    const payload = { 
      sub: user.id, 
      tenantId: user.tenant_id, // Este es el dato clave que usaremos para el RLS luego
      email: user.email,
      name: user.full_name
    };

    return {
      access_token: this.jwtService.sign(payload),
      message: 'Login exitoso',
    };
  }
  // Agrega esta función debajo de tu login
  async register(loginDto: LoginDto) {
    // 1. Generamos el hash criptográfico real
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(loginDto.password, salt);

    // 2. Usamos el Tenant de prueba que ya tenemos en PostgreSQL
    const tenantId = '11111111-1111-1111-1111-111111111111';

    // 3. Modificamos el email para que no choque con el que ya pusimos mal en la BD
    const nuevoEmail = 'gerente@techsolutions.com';

    // 4. Guardamos en la base de datos
    await this.dataSource.query(
      `INSERT INTO users (tenant_id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)`,
      [tenantId, nuevoEmail, hash, 'Jhonathan Gerente']
    );

    return { 
      message: '¡Usuario registrado exitosamente con hash real!',
      email: nuevoEmail 
    };
  }
}