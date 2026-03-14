import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express'; // <-- Importamos Request

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      // --- FIX BUG #5: Leer token desde la cookie ---
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          // Buscamos la cookie que acabamos de crear en el controller
          const token = request?.cookies?.token;
          if (!token) {
            return null;
          }
          return token;
        },
      ]),
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