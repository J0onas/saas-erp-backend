import { Controller, Get, Req, Res, UseGuards, Sse } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotificationsService } from './notifications.service';
import type { Request, Response } from 'express';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // GET /api/v1/notifications/stream
  // Conexión SSE — el frontend se conecta aquí y recibe eventos en tiempo real
  @UseGuards(AuthGuard('jwt'))
  @Get('stream')
  async stream(@Req() req: Request & { user: any }, @Res() res: Response) {
    const tenantId = req.user.tenantId;

    // Headers SSE obligatorios
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Para nginx/proxies
    res.flushHeaders();

    // Registrar el cliente
    this.notificationsService.addClient(tenantId, res);

    // Keepalive cada 30 segundos para evitar timeout
    const keepalive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepalive);
      }
    }, 30_000);

    // Limpiar al desconectar
    req.on('close', () => {
      clearInterval(keepalive);
      this.notificationsService.removeClient(tenantId, res);
    });
  }
}
