import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios'; // <-- INYECTAMOS EL MOTOR DE BÚSQUEDA WEB
import { ClientService } from './client.service';
import { ClientController } from './client.controller';

@Module({
  imports: [HttpModule], // <-- LO REGISTRAMOS AQUÍ
  controllers: [ClientController],
  providers: [ClientService],
})
export class ClientModule {}