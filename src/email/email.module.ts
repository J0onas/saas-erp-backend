import { Module } from '@nestjs/common';
import { EmailService } from './email.service';

@Module({
  providers: [EmailService],
  exports: [EmailService] // <-- CLAVE: Lo exportamos para que Facturación pueda usarlo
})
export class EmailModule {}