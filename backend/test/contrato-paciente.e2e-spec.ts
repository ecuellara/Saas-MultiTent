/**
 * Contrato del formulario de paciente (frontend ⇄ backend).
 *
 * POR QUÉ EXISTE ESTE SPEC: los demás e2e montan la app con
 * `Test.createTestingModule` y `setGlobalPrefix('api')`, pero **no** aplican el
 * `ValidationPipe` global de `main.ts`. En producción ese pipe va con
 * `whitelist` + `forbidNonWhitelisted` + `transform`, y el formulario del
 * frontend envía el objeto COMPLETO (los campos vacíos como `null`). Un
 * desajuste con el DTO daría un 400 que ninguna prueba actual detectaría: se
 * vería solo al usar la aplicación.
 *
 * Aquí se reproduce la configuración real (pipe + filtro global) y se envía
 * exactamente el cuerpo que construye `frontend/src/services/pacientes.ts`
 * (`aPayload()`).
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { GlobalExceptionFilter } from '../src/core/filters/global-exception.filter.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

/** Campos que el formulario del frontend SIEMPRE envía. */
const CAMPOS_FORMULARIO = [
  'tipoDoc',
  'numDoc',
  'nombres',
  'apellidos',
  'fechaNac',
  'sexo',
  'grupoSanguineo',
  'telefono',
  'email',
  'direccion',
  'ubigeoCodigo',
  'contactoEmergenciaNombre',
  'contactoEmergenciaTelefono',
  'representanteNombre',
  'representanteDni',
  'representanteParentesco',
  'representanteDomicilio',
  'alergias',
  'enfermedades',
  'medicamentos',
  'habitos',
  'antecedentes',
] as const;

/**
 * Espejo de `aPayload()` en el frontend: todos los campos, los vacíos como
 * `null` (que `@IsOptional()` ignora) y `activo` como booleano.
 */
function cuerpoDelFrontend(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = { activo: true };
  for (const campo of CAMPOS_FORMULARIO) base[campo] = null;
  base.tipoDoc = 'DNI';
  base.nombres = 'Valeria';
  base.apellidos = 'Quispe';
  base.telefono = '999000111';
  return { ...base, ...extra };
}

describe('Contrato del formulario de paciente', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let H: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    // Misma configuración que `src/main.ts`: sin esto el spec no probaría el
    // `forbidNonWhitelisted` que sí existe en producción.
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    H = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) await limpiarDosTenants(prisma);
    if (app) await app.close();
  });

  it('acepta el cuerpo completo del formulario y respeta los vacíos como null', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/pacientes')
      .set(H)
      .send(cuerpoDelFrontend({ email: null }))
      .expect(201);

    const p = r.body as Record<string, unknown>;
    expect(p.nombres).toBe('Valeria');
    expect(p.apellidos).toBe('Quispe');
    expect(p.tipoDoc).toBe('DNI');
    expect(p.telefono).toBe('999000111');
    // Los que iban a `null` vuelven como `null`, no como cadena vacía.
    expect(p.direccion).toBeNull();
    expect(p.alergias).toBeNull();
    expect(p.fechaNac).toBeNull();
    expect(p.representanteDni).toBeNull();
    // Y no se cuela nada del cliente.
    expect(p.tenantId).toBe(datos.a.tenantId);
  });

  it('acepta la fecha como instante ISO (lo que envía el formulario)', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/pacientes')
      .set(H)
      .send(
        cuerpoDelFrontend({
          nombres: 'Con',
          apellidos: 'Fecha',
          // Espejo de `deInputFecha()` en `frontend/src/services/pacientes.ts`.
          fechaNac: '2015-03-09T00:00:00.000Z',
        }),
      );

    // El cuerpo va en el mensaje: un 400 aquí sin ver el motivo obliga a
    // reproducir la petición a mano.
    expect(r.status, JSON.stringify(r.body)).toBe(201);

    const p = r.body as { fechaNac: string };
    expect(p.fechaNac).toBe('2015-03-09T00:00:00.000Z');
  });

  it('rechaza la fecha en forma corta: por eso el frontend la convierte', async () => {
    // `Paciente.fechaNac` es `DateTime` y Prisma NO acepta `aaaa-mm-dd`: responde
    // «Datos inválidos», que el filtro global traduce a 400. Este caso fija el
    // motivo por el que el formulario envía un instante completo y por el que las
    // vistas formatean estas fechas en UTC (a medianoche UTC, formatear en hora
    // local mostraría el día anterior en husos negativos como Lima).
    const r = await request(app.getHttpServer())
      .post('/api/pacientes')
      .set(H)
      .send(cuerpoDelFrontend({ nombres: 'Corta', apellidos: 'Fecha', fechaNac: '2015-03-09' }));

    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect((r.body as { message: unknown }).message).toBe('Datos inválidos');
  });

  it('el PATCH acepta el mismo cuerpo completo', async () => {
    const creado = await request(app.getHttpServer())
      .post('/api/pacientes')
      .set(H)
      .send(cuerpoDelFrontend({ nombres: 'Antes', apellidos: 'Editar' }))
      .expect(201);
    const id = (creado.body as { id: string }).id;

    const r = await request(app.getHttpServer())
      .patch(`/api/pacientes/${id}`)
      .set(H)
      .send(cuerpoDelFrontend({ nombres: 'Despues', apellidos: 'Editado', telefono: null }))
      .expect(200);

    const p = r.body as Record<string, unknown>;
    expect(p.nombres).toBe('Despues');
    expect(p.apellidos).toBe('Editado');
    expect(p.telefono).toBeNull();
  });

  it('rechaza un campo fuera del DTO (whitelist activa)', async () => {
    // El frontend no envía `tenantId`, pero si algún día lo hiciera debe fallar
    // aquí y no intentar escribir en otra clínica.
    await request(app.getHttpServer())
      .post('/api/pacientes')
      .set(H)
      .send(cuerpoDelFrontend({ tenantId: datos.b.tenantId }))
      .expect(400);
  });

  it('un correo inválido devuelve 400 con `message` en ARRAY', async () => {
    // Forma que el frontend aplana en `mensajeDeError`: antes se hacía
    // `String(message)` y el usuario leía los mensajes unidos por comas.
    const r = await request(app.getHttpServer())
      .post('/api/pacientes')
      .set(H)
      .send(cuerpoDelFrontend({ email: 'no-es-un-correo' }))
      .expect(400);

    const message = (r.body as { message: unknown }).message;
    expect(Array.isArray(message)).toBe(true);
    expect((message as string[]).length).toBeGreaterThan(0);
  });
});
