import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // ¡EL FIX PARA EL ERROR 404! Le decimos que todo empieza con /api/v1
  app.setGlobalPrefix('api/v1');
  
  app.use(cookieParser());
  
  app.enableCors({
    origin: [
      'http://localhost:3000', 
      'https://posmart-app.vercel.app',
      // ¡EL PASE VIP MAESTRO! Acepta cualquier subdominio dinámico de tu proyecto en Vercel
      /^https:\/\/posmart-app-.*\.vercel\.app$/
    ],
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });
  
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  
  await app.listen(process.env.PORT || 3000);
}
bootstrap();