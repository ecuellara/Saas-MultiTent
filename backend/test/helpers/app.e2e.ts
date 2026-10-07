import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { GlobalExceptionFilter } from '../../src/core/filters/global-exception.filter.js';

/**
 * Monta la app e2e con la MISMA configuración global que `src/main.ts`:
 * prefijo `api`, `ValidationPipe` (`whitelist` + `forbidNonWhitelisted` +
 * `transform`) y `GlobalExceptionFilter`.
 *
 * Invariante 5: TODOS los specs pasan por aquí. Sin esto, un spec probaría
 * una API distinta de la de producción (p. ej. un `@Body() dto: {...}`
 * literal pasaría la validación en el test y fallaría en producción).
 */
export async function montarAppE2E(modulo: TestingModule): Promise<INestApplication> {
  const app = modulo.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}
