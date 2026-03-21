import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { EmailModule } from '../email/email.module';
import { NubefactService } from './utils/NubefactService';
import { CreditNoteService } from './credit-note.service';

@Module({
    imports: [HttpModule, EmailModule],
    controllers: [InvoiceController],
    providers: [InvoiceService, NubefactService, CreditNoteService],
    exports: [InvoiceService, CreditNoteService],
})
export class InvoiceModule {}
