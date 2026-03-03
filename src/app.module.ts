import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InvoiceModule } from './invoice/invoice.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'saas_app_user', // El rol restringido que creamos
      password: 'saas_password_123', // Pon aquí tu contraseña real
      database: 'postgres', // La base de datos por defecto de pgAdmin
      autoLoadEntities: true,
      synchronize: false, // APAGADO. Nosotros controlamos la BD con SQL.
    }),
    InvoiceModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}