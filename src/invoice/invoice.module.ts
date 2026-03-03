import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios'; // <-- IMPORTACIÓN NUEVA
import { InvoiceService } from './invoice.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceEntity } from './entities/invoice.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvoiceEntity]),
    HttpModule // <-- HABILITADO AQUÍ
  ],
  controllers: [InvoiceController],
  providers: [InvoiceService],
})
export class InvoiceModule {}