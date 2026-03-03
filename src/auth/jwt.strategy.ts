import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      // Le decimos que busque el token en la cabecera "Authorization: Bearer <token>"
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // ¡Debe ser exactamente la misma clave que pusimos en el auth.module!
      secretOrKey: 'MI_CLAVE_SECRETA_SUPER_SEGURA_123', 
    });
  }

  // Si el token es válido y nadie lo alteró, esta función se ejecuta
  async validate(payload: any) {
    // Retornamos los datos desencriptados. 
    // NestJS inyectará este objeto automáticamente en la variable "request.user"
    return { 
      userId: payload.sub, 
      tenantId: payload.tenantId, 
      email: payload.email 
    };
  }
}