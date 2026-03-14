import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // 2. Le decimos a NestJS que procese las cookies entrantes
  app.use(cookieParser());
  
  // 3. El nuevo candado de CORS (Solo deja pasar a tu entorno local y a tu Vercel)
  app.enableCors({
    origin: [
      'http://localhost:3000', // Tu frontend cuando desarrollas en tu PC
      'https://saas-erp-frontend-dxmzj3zfr-j0onas-projects.vercel.app' // Tu frontend en producción en Vercel
    ],
    credentials: true, // <-- VITAL: Esta es la llave que permite que la cookie httpOnly viaje
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });
  
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  
  // Usamos process.env.PORT para que Render asigne el puerto dinámicamente, o 3000 en local
  await app.listen(process.env.PORT || 3000);
}
bootstrap();