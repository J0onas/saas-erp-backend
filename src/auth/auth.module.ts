import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy'; // <-- IMPORTADO

@Module({
  imports: [
    JwtModule.register({
      secret: 'MI_CLAVE_SECRETA_SUPER_SEGURA_123', 
      signOptions: { expiresIn: '8h' }, 
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy], // <-- AGREGADO A LA LISTA
})
export class AuthModule {}