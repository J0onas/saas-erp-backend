import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express'; // <-- Importamos Request

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      // --- VOLVEMOS AL ESTÁNDAR BEARER TOKEN ---
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'tu_secreto_super_seguro', 
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