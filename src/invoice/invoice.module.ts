import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { EmailModule } from '../email/email.module';
import { NubefactService } from './utils/NubefactService';

@Module({
    imports: [
        HttpModule,
        EmailModule,
    ],
    controllers: [InvoiceController],
    providers: [
        InvoiceService,
        NubefactService,   // ← nuevo proveedor
    ],
    exports: [InvoiceService],
})
export class InvoiceModule {}