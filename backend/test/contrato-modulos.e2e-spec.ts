/**
 * Contrato de validación de los módulos con cuerpo validado (citas, pagos,
 * historiales).
 *
 * POR QUÉ EXISTE: los e2e del proyecto montan la app con `Test.createTestingModule`
 * y `setGlobalPrefix('api')`, pero **no** aplican el `ValidationPipe` global de
 * `main.ts` (`whitelist` + `forbidNonWhitelisted` + `transform`). Este spec sí lo
 * aplica, igual que `contrato-paciente.e2e-spec.ts`, y envía los cuerpos tal como
 * los construiría un cliente.
 *
 * Lo que fija, y por qué importa:
 *  1. **Formato de fecha uniforme.** Un campo `DateTime`/`@db.Date` de Prisma
 *     rechaza `aaaa-mm-dd` («Datos inválidos» → 400). Todos los servicios salvo
 *     `pacientes` normalizaban con `new Date(dto.fecha)`; aquí se fija que la
 *     forma corta —la que devuelve `<input type="date">`— funciona en todos.
 *  2. **Forma del error de validación.** Nest devuelve `message` como ARRAY; el
 *     frontend lo aplana en `mensajeDeError`.
 *  3. **Whitelist.** Un campo que no está en el DTO se rechaza con 400.
 *  4. **Validación anidada.** Las `cuotas` del pago se declaran con un DTO real:
 *     antes eran un `Array<{...}>` sin validadores y su contenido no se
 *     comprobaba en absoluto.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { GlobalExceptionFilter } from '../src/core/filters/global-exception.filter.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

/** Mensaje del `message` de Nest, que puede venir como cadena o como array. */
function textoMensaje(body: unknown): string {
  const m = (body as { message?: unknown }).message;
  if (Array.isArray(m)) return m.join(' | ');
  return typeof m === 'string' ? m : '';
}

describe('Contrato de validación de módulos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let H: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    // Misma configuración que `src/main.ts`.
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

  const http = () => request(app.getHttpServer());

  // ---------------------------------------------------------------- Citas ----

  describe('citas', () => {
    it('acepta la fecha en forma corta y la guarda en ese día', async () => {
      const r = await http()
        .post('/api/citas')
        .set(H)
        .send({
          pacienteId: datos.a.pacienteId,
          tratamientoId: datos.a.tratamientoId,
          sedeId: datos.a.sedeId,
          // Exactamente lo que devuelve un `<input type="date">`.
          fecha: '2026-12-24',
          horaInicio: '23:00',
          horaFin: '23:30',
        });

      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const cita = r.body as { fecha: string; horaInicio: string; token: string };
      expect(cita.fecha.slice(0, 10)).toBe('2026-12-24');
      expect(cita.horaInicio).toBe('23:00');
      // El token de cita se genera en el servidor.
      expect(cita.token).toMatch(/^CIT-[0-9A-F]{8}$/);
    });

    it('rechaza una hora sin el formato HH:MM con el mensaje en ARRAY', async () => {
      const r = await http()
        .post('/api/citas')
        .set(H)
        .send({
          pacienteId: datos.a.pacienteId,
          fecha: '2026-12-25',
          horaInicio: '9:00',
          horaFin: '09:30',
        });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(Array.isArray((r.body as { message: unknown }).message)).toBe(true);
      expect(textoMensaje(r.body)).toContain('horaInicio debe ser HH:MM');
    });

    it('rechaza campos fuera del DTO', async () => {
      await http()
        .post('/api/citas')
        .set(H)
        .send({
          pacienteId: datos.a.pacienteId,
          fecha: '2026-12-26',
          horaInicio: '10:00',
          horaFin: '10:30',
          tenantId: datos.b.tenantId,
        })
        .expect(400);
    });

    it('rechaza un estado de cita que no está en la lista', async () => {
      await http()
        .patch(`/api/citas/${datos.a.citaId}`)
        .set(H)
        .send({ estado: 'inventado' })
        .expect(400);
    });
  });

  // ---------------------------------------------------------------- Pagos ----

  describe('pagos', () => {
    it('acepta la fecha corta y crea las cuotas con su vencimiento', async () => {
      const r = await http()
        .post('/api/pagos')
        .set(H)
        .send({
          concepto: 'Ortodoncia',
          tipo: 'ingreso',
          pacienteId: datos.a.pacienteId,
          montoTotal: 1200,
          montoPagado: 200,
          metodoPago: 'efectivo',
          fecha: '2026-04-15',
          detalles: [{ descripcion: 'Brackets', cantidad: 1, precioUnit: 1200 }],
          cuotas: [
            { nroCuota: 1, monto: 500, fechaVencimiento: '2026-05-15' },
            { nroCuota: 2, monto: 500, fechaVencimiento: '2026-06-15' },
          ],
        });

      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const pago = r.body as { id: string; fecha: string; saldo: number; estado: string };
      expect(pago.fecha.slice(0, 10)).toBe('2026-04-15');
      // 1200 - 200: el saldo y el estado los calcula el servidor.
      expect(Number(pago.saldo)).toBe(1000);
      expect(pago.estado).toBe('parcial');

      const cuotas = await prisma.cuota.findMany({
        where: { pagoId: pago.id },
        orderBy: { nroCuota: 'asc' },
      });
      expect(cuotas).toHaveLength(2);
      expect(cuotas[0]!.fechaVencimiento.toISOString().slice(0, 10)).toBe('2026-05-15');
      expect(cuotas[1]!.fechaVencimiento.toISOString().slice(0, 10)).toBe('2026-06-15');
    });

    it('rechaza un monto total por debajo del mínimo', async () => {
      const r = await http()
        .post('/api/pagos')
        .set(H)
        .send({ concepto: 'Cero', tipo: 'ingreso', montoTotal: 0 });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('montoTotal');
    });

    it('VALIDA el contenido de las cuotas (antes no se comprobaba nada)', async () => {
      // `cuotas` se declaraba `Array<{...}>` con solo `@IsOptional()`: la
      // propiedad pasaba el whitelist pero su contenido no se validaba, así que
      // `nroCuota: 'uno'` llegaba hasta Prisma. Con `@ValidateNested` se corta
      // aquí, con el nombre del campo en el mensaje.
      const r = await http()
        .post('/api/pagos')
        .set(H)
        .send({
          concepto: 'Cuota mala',
          tipo: 'ingreso',
          montoTotal: 100,
          cuotas: [{ nroCuota: 'uno', monto: 50, fechaVencimiento: '2026-05-15' }],
        });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('nroCuota');
    });

    it('rechaza una cuota sin fecha de vencimiento', async () => {
      const r = await http()
        .post('/api/pagos')
        .set(H)
        .send({
          concepto: 'Cuota sin fecha',
          tipo: 'ingreso',
          montoTotal: 100,
          cuotas: [{ nroCuota: 1, monto: 50 }],
        });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('fechaVencimiento');
    });

    it('el abono acepta la fecha corta y recalcula el saldo', async () => {
      const antes = await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } });

      const r = await http()
        .post(`/api/pagos/${datos.a.pagoId}/abonos`)
        .set(H)
        .send({ monto: 30, metodoPago: 'yape', fecha: '2026-03-20' });

      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const despues = await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } });
      expect(Number(despues.montoPagado)).toBe(Number(antes.montoPagado) + 30);
      expect(Number(despues.saldo)).toBe(Number(antes.saldo) - 30);
    });
  });

  // ---------------------------------------------------------- Historiales ----

  describe('historiales', () => {
    it('acepta la fecha en forma corta', async () => {
      const r = await http()
        .post('/api/historiales')
        .set(H)
        .send({
          pacienteId: datos.a.pacienteId,
          fecha: '2026-05-05',
          hora: '11:00',
          motivo: 'Control de ortodoncia',
          diagnostico: 'Sin hallazgos',
        });

      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect((r.body as { fecha: string }).fecha.slice(0, 10)).toBe('2026-05-05');
    });

    it('exige motivo y paciente', async () => {
      const r = await http().post('/api/historiales').set(H).send({ fecha: '2026-05-06' });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      const texto = textoMensaje(r.body);
      expect(texto).toContain('motivo');
      expect(texto).toContain('pacienteId');
    });
  });

  // --------------------------------------------- Plataforma (MFA y clave) ----

  describe('plataforma: los cuerpos de MFA se validan', () => {
    // Estos cuerpos se declaraban como tipo literal (`@Body() dto: { code: string }`),
    // y con eso el pipe NO valida: el metatipo de un objeto literal es `Object`.
    // Como `mfa/verify` es `@Public()`, la validación es la única barrera antes
    // del servicio.

    it('rechaza un `code` numérico con 400 (antes: 500 desde verificarTotp)', async () => {
      const r = await http()
        .post('/api/platform/auth/mfa/verify')
        .send({ temp_token: 'token-invalido', code: 123456 });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('code');
    });

    it('rechaza un cuerpo vacío nombrando los dos campos', async () => {
      const r = await http().post('/api/platform/auth/mfa/verify').send({});

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      const texto = textoMensaje(r.body);
      expect(texto).toContain('temp_token');
      expect(texto).toContain('code');
    });

    it('rechaza un código que no tiene 6 dígitos', async () => {
      // Se prueba en `mfa/verify` porque es `@Public()`: en `mfa/confirm` el
      // `PlatformGuard` corre ANTES que el pipe y sin token de alta devolvería
      // 401, sin llegar nunca a validar el cuerpo.
      const r = await http()
        .post('/api/platform/auth/mfa/verify')
        .send({ temp_token: 'token-invalido', code: 'abcdef' });

      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(textoMensaje(r.body)).toContain('6 dígitos');
    });
  });
});
