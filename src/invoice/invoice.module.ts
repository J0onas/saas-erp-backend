import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { InvoiceService } from './invoice.service';
import { InvoiceController } from './invoice.controller';
import { EmailModule } from '../email/email.module'; // <-- IMPORTAMOS EL MÓDULO

@Module({
  imports: [HttpModule, EmailModule], // <-- LO AGREGAMOS AQUÍ
  controllers: [InvoiceController],
  providers: [InvoiceService],
})
export class InvoiceModule {}