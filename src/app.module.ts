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
import { UsersModule } from './users/users.module';
import { InventoryModule } from './inventory/inventory.module';

@Module({
    imports: [
        TypeOrmModule.forRoot({
            type: 'postgres',
            url: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
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
        UsersModule,
        InventoryModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
