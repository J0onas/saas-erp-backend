import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'MI_CLAVE_SECRETA_SUPER_SEGURA_123', 
      signOptions: { expiresIn: '8h' }, 
    }),
    EmailModule, // Para enviar emails de recuperación
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}