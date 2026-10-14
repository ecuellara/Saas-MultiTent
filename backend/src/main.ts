import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { fileURLToPath } from 'node:url';

// Resolver respecto a src/main.ts o dist/main.js, no al directorio desde el
// que se lanzó Node. Las variables del proceso conservan prioridad sobre .env.
try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch (e) {
  // Solo un archivo ausente es opcional; otros errores no deben ocultarse.
  if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e;
}
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { GlobalExceptionFilter } from './core/filters/global-exception.filter.js';

async function bootstrap(): Promise<void> {
  // `trust proxy`: cuántos saltos de proxy hay delante de la API.
  // `TRUST_PROXY` (entero >= 0, por defecto 2 = Cloudflare → Nginx → API,
  // doc §5 y §8.2). Con un valor MAYOR que los saltos reales, `req.ip` sería
  // la IP de un proxy y el rate limit por IP se degradaría a un cubo
  // compartido por todos los clientes (además de ensuciar la auditoría).
  // Valores: 2 con CDN+proxy, 1 detrás de un solo nginx (compose staging),
  // 0 si la API queda expuesta directamente. Si falta o no es válido, el
  // arranque FALLA: un valor silenciosamente erróneo es peor que no arrancar.
  if (process.env.NODE_ENV === 'production' && !process.env.TRUST_PROXY?.trim()) {
    throw new Error('TRUST_PROXY es obligatorio en producción; configure el número real de proxies');
  }
  const saltos = Number(process.env.TRUST_PROXY ?? 2);
  if (!Number.isInteger(saltos) || saltos < 0) {
    throw new Error('TRUST_PROXY debe ser un entero >= 0 (0 directo, 1 un proxy, 2 CDN+proxy)');
  }
  const app = await NestFactory.create(AppModule);
  (app.getHttpAdapter().getInstance() as { set?: (k: string, v: unknown) => void }).set?.(
    'trust proxy',
    saltos,
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
bootstrap().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
