import { NestFactory  } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { CacheInterceptor } from '@nestjs/cache-manager';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true, 
    }),
  );

  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'];

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // app.useGlobalInterceptors(app.get(CacheInterceptor));

  app.useGlobalFilters(new AllExceptionsFilter());
  console.log("App is running on http://localhost:" + (process.env.PORT ?? 3000));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
