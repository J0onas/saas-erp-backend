import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InvoiceModule } from './invoice/invoice.module';
import { AuthModule } from './auth/auth.module';
import { ClientModule } from './client/client.module';
import { ProductModule } from './product/product.module';
import { EmailModule } from './email/email.module';
import { SettingsModule } from './settings/settings.module';
import { CashModule } from './cash/cash.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
  type: 'postgres',
  
  // 1. Pega tu NUEVO link de "Transaction" aquí.
  // 2. Reemplaza [YOUR-PASSWORD] por: n8JeEWZ9TeEwK%40C
  url: 'postgresql://postgres.jshsfrqeapbggbwmadcw:n8JeEWZ9TeEwK%40C@aws-1-sa-east-1.pooler.supabase.com:6543/postgres',
  
  // Esto es obligatorio para Supabase
  ssl: { 
    rejectUnauthorized: false 
  },
  
  autoLoadEntities: true,
  synchronize: false,
}),
    InvoiceModule,
    AuthModule,
    ClientModule,
    ProductModule,
    EmailModule,
    SettingsModule,
    CashModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}