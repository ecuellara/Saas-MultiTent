import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './core/filters/global-exception.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // `trust proxy` para que el rate-limit por IP funcione detrás de Nginx/Traefik.
  (app.getHttpAdapter().getInstance() as { set?: (k: string, v: unknown) => void }).set?.(
    'trust proxy',
    1,
  );
  app.setGlobalPrefix('api');
  // CORS (doc §8.7): orígenes explícitos con trim; credentials SÍ porque el
  // refresh viaja en cookie httpOnly (Bearer sigue siendo lo primario).
  // SameSite=Strict cubre app/api como mismo sitio (subdominios del eTLD+1).
  const origins = (process.env.FRONTEND_URL ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-Id', 'X-Request-Id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  // Contrato OpenAPI (mejora #20): una sola fuente para el frontend.
  const documento = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Dental SaaS')
      .setDescription('API multi-tenant: JWT + X-Tenant-Id')
      .setVersion('0.3.0')
      .addBearerAuth()
      .addApiKey({ type: 'apiKey', name: 'X-Tenant-Id', in: 'header' }, 'X-Tenant-Id')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, documento);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

// eslint-disable-next-line no-console
bootstrap().catch((e) => console.error(e));
