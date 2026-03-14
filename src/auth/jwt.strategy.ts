import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // ¡TIENE QUE SER EXACTAMENTE LA MISMA!
      secretOrKey: process.env.JWT_SECRET || 'MI_CLAVE_SECRETA_SUPER_SEGURA_123', 
    });
  }

  async validate(payload: any) {
    // Esto se mantiene igual
    return { 
      userId: payload.sub, 
      tenantId: payload.tenantId, 
      email: payload.email, 
      role: payload.role 
    };
  }
}