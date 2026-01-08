import { NestFactory  } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { CacheInterceptor } from '@nestjs/cache-manager';
import * as bodyParser from 'body-parser';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Default body parser limit (1mb) for most routes
  app.use(bodyParser.json({ limit: '1mb' }));
  app.use(bodyParser.urlencoded({ limit: '1mb', extended: true }));

  // Larger limit only for notes routes (rich text content)
  app.use('/note', bodyParser.json({ limit: '10mb' }));
  app.use('/note', bodyParser.urlencoded({ limit: '10mb', extended: true }));

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true, 
    }),
  );

  const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'https://merge-edu.netlify.app', 'https://merge-frontend.onrender.com'];

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
