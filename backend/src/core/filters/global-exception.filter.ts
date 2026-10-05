import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Filtro global de excepciones (doc §7.4).
 * Traduce errores de Prisma y validación a HTTP correctos en lugar de 500.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return this.send(res, new ConflictException('Recurso duplicado'));
        case 'P2025':
          return this.send(res, new NotFoundException('Recurso no encontrado'));
        case 'P2003':
          return this.send(res, new BadRequestException('Referencia inválida'));
        case 'P2034':
          return this.send(res, new ConflictException('Conflicto de escritura, reintente'));
        default:
          // Se registra el código para diagnóstico: el mensaje al cliente no lo
          // expone (evita filtrar detalles del esquema), pero sin log es
          // imposible distinguir un P2021 de un P2024 en producción.
          // eslint-disable-next-line no-console
          console.error(`[prisma:${exception.code}]`, exception.message);
          return this.send(
            res,
            new HttpException('Error de base de datos', HttpStatus.BAD_REQUEST),
          );
      }
    }
    if (
      exception instanceof Prisma.PrismaClientValidationError ||
      (exception instanceof Error && exception.name === 'PrismaClientValidationError')
    ) {
      return this.send(res, new BadRequestException('Datos inválidos'));
    }
    if (exception instanceof HttpException) {
      return this.send(res, exception);
    }
    if (exception instanceof Error && exception.message === 'TenantContext no disponible') {
      return this.send(res, new BadRequestException('Contexto de tenant ausente'));
    }
    // Error no mapeado: se registra en servidor y se devuelve 500 genérico.
    // eslint-disable-next-line no-console
    console.error('[unhandled]', exception);
    return this.send(
      res,
      new HttpException('Error interno', HttpStatus.INTERNAL_SERVER_ERROR),
    );
  }

  private send(res: { status: (c: number) => unknown }, exception: HttpException): void {
    const status = exception.getStatus();
    const body = exception.getResponse() as string | Record<string, unknown>;
    const payload =
      typeof body === 'string'
        ? { statusCode: status, message: body }
        : { statusCode: status, ...(body as object) };
    (res as unknown as { status: (c: number) => { json: (b: unknown) => void } })
      .status(status)
      .json(payload);
  }
}
