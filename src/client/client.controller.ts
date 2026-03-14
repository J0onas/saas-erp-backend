import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ClientService } from './client.service';

@Controller('clients')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  @UseGuards(AuthGuard('jwt')) // Protegido con llave maestra
  @Get('search/:document')
  async searchClient(@Param('document') documentNumber: string, @Req() req: any) {
    // req.user.tenantId viene de tu token de inicio de sesión
    return await this.clientService.findByDocument(documentNumber, req.user.tenantId);
  }
}