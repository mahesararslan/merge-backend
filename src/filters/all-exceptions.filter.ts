import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Something went wrong';

    // If it's a NestJS HttpException (e.g. BadRequestException, UnauthorizedException)
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as any).message || message;
    }

    // If it's a normal JS Error
    else if (exception instanceof Error) {
      message = exception.message;
    }

    // If it's a DB error (Postgres unique violation, etc.)
    if ((exception as any).code === '23505') {
      status = HttpStatus.CONFLICT;
      message = 'Duplicate entry already exists';
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
