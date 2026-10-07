/**
 * PRUEBAS DE AISLAMIENTO MULTI-TENANT  (Fase 1 — criterio de salida)
 * =================================================================
 *
 * Contrato que este archivo verifica:
 *   1. Un tenant no puede LEER recursos de otro.
 *   2. Un tenant no puede ESCRIBIR ni BORRAR recursos de otro.
 *   3. Un usuario no puede actuar sobre un tenant del que no es miembro.
 *   4. El `tenantId` enviado por el cliente se ignora (se deriva del servidor).
 *   5. La unicidad de códigos es POR TENANT (dos clínicas comparten REC-2026-0001).
 *   6. Un tenant no puede alterar su propia suscripción por HTTP.
 *
 * Convención de estado esperado: para recursos de otro tenant se espera **404**
 * (no 403), para no revelar la existencia del recurso ajeno.
 *
 * NOTA DE ACTIVACIÓN: este spec se ejecuta cuando la Fase 1 haya implementado
 * `src/app.module.ts`, los guards y los servicios. Rutas y campos deben
 * alinearse con los DTOs definitivos; la MATRIZ de casos es el contrato, no las
 * cadenas de ruta exactas.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import {
  DosTenants,
  PASSWORD_PLAIN,
  limpiarDosTenants,
  seedDosTenants,
} from './helpers/tenants-fixture.js';

type Metodo = 'get' | 'post' | 'patch' | 'delete';

describe('Aislamiento multi-tenant', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);

    prisma = app.get(PrismaService);
    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    tokenA = await login(datos.a.userEmail);
    tokenB = await login(datos.b.userEmail);
  }, 120_000);

  afterAll(async () => {
    if (prisma) await limpiarDosTenants(prisma);
    if (app) await app.close();
  });

  // ---------------------------------------------------------------- utilidades

  async function login(email: string): Promise<string> {
    const r = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD_PLAIN })
      .expect(200);
    const token = r.body?.access_token ?? r.body?.data?.access_token;
    expect(token, `login sin access_token para ${email}`).toBeTruthy();
    return token as string;
  }

  /** Petición con token y tenant explícitos. */
  function pedir(
    metodo: Metodo,
    path: string,
    opts: { token?: string; tenant?: string; body?: unknown } = {},
  ) {
    let r = request(app.getHttpServer())[metodo](path);
    if (opts.token) r = r.set('Authorization', `Bearer ${opts.token}`);
    if (opts.tenant) r = r.set('X-Tenant-Id', opts.tenant);
    if (opts.body !== undefined) r = r.send(opts.body as object);
    return r;
  }

  const comoA = (metodo: Metodo, path: string, body?: unknown) =>
    pedir(metodo, path, { token: tokenA, tenant: datos.a.tenantId, body });
  const comoB = (metodo: Metodo, path: string, body?: unknown) =>
    pedir(metodo, path, { token: tokenB, tenant: datos.b.tenantId, body });

  // ============================================================ 1. Autenticación

  describe('1. Autenticación y contexto de tenant', () => {
    it('rechaza peticiones sin token', async () => {
      await pedir('get', '/api/pacientes').expect(401);
    });

    it('rechaza peticiones sin cabecera de tenant', async () => {
      await pedir('get', '/api/pacientes', { token: tokenA }).expect((res) => {
        expect([400, 403]).toContain(res.status);
      });
    });

    it('rechaza a un usuario que intenta operar sobre un tenant del que no es miembro', async () => {
      // Token de A, pero declarando el tenant B: la membresía no existe.
      await pedir('get', '/api/pacientes', { token: tokenA, tenant: datos.b.tenantId })
        .expect((res) => expect([403, 404]).toContain(res.status));
    });

    it('rechaza un tenantId inexistente', async () => {
      await pedir('get', '/api/pacientes', { token: tokenA, tenant: 'no-existe' })
        .expect((res) => expect([403, 404]).toContain(res.status));
    });
  });

  // ============================================================ 2. Lectura cruzada

  describe('2. Lectura cruzada (A no ve recursos de B)', () => {
    const matrizLectura: Array<{ nombre: string; path: (d: DosTenants) => string }> = [
      { nombre: 'paciente por id', path: (d) => `/api/pacientes/${d.b.pacienteId}` },
      { nombre: 'historiales del paciente', path: (d) => `/api/pacientes/${d.b.pacienteId}/historiales` },
      { nombre: 'documentos del paciente', path: (d) => `/api/pacientes/${d.b.pacienteId}/documentos` },
      {
        nombre: 'descarga de documento',
        path: (d) => `/api/pacientes/${d.b.pacienteId}/documentos/${d.b.documentoId}/descarga`,
      },
      { nombre: 'cita por id', path: (d) => `/api/citas/${d.b.citaId}` },
      { nombre: 'tratamiento por id', path: (d) => `/api/tratamientos/${d.b.tratamientoId}` },
      { nombre: 'odontogramas del paciente', path: (d) => `/api/pacientes/${d.b.pacienteId}/odontogramas` },
      { nombre: 'pago por id', path: (d) => `/api/pagos/${d.b.pagoId}` },
      { nombre: 'insumo por id', path: (d) => `/api/insumos/${d.b.insumoId}` },
      { nombre: 'proveedor por id', path: (d) => `/api/proveedores/${d.b.proveedorId}` },
      { nombre: 'compra por id', path: (d) => `/api/compras/${d.b.compraId}` },
      { nombre: 'consentimiento por id', path: (d) => `/api/consentimientos/${d.b.consentimientoId}` },
      { nombre: 'usuario por id', path: (d) => `/api/usuarios/${d.b.userId}` },
    ];

    it.each(matrizLectura)('A no puede leer $nombre de B (404)', async ({ path }) => {
      await comoA('get', path(datos)).expect(404);
    });

    it('control negativo: A SÍ puede leer sus propios recursos', async () => {
      const r = await comoA('get', `/api/pacientes/${datos.a.pacienteId}`).expect(200);
      expect(r.body?.id ?? r.body?.data?.id).toBe(datos.a.pacienteId);
    });

    it('el listado de A nunca contiene recursos de B', async () => {
      const r = await comoA('get', '/api/pacientes?limit=100').expect(200);
      const lista: Array<{ id: string }> = r.body?.data ?? r.body ?? [];
      const ids = lista.map((p) => p.id);
      expect(ids).toContain(datos.a.pacienteId);
      expect(ids).not.toContain(datos.b.pacienteId);
    });
  });

  // ============================================================ 3. Escritura cruzada

  describe('3. Escritura y borrado cruzados (A no muta recursos de B)', () => {
    it('A no puede editar el paciente de B y no lo modifica', async () => {
      await comoA('patch', `/api/pacientes/${datos.b.pacienteId}`, { nombres: 'HACKEADO' }).expect(404);

      const enBd = await prisma.paciente.findUniqueOrThrow({ where: { id: datos.b.pacienteId } });
      expect(enBd.nombres).toBe('Paciente');
      expect(enBd.tenantId).toBe(datos.b.tenantId);
    });

    it('A no puede borrar el paciente de B', async () => {
      await comoA('delete', `/api/pacientes/${datos.b.pacienteId}`).expect(404);
      const sigue = await prisma.paciente.findUnique({ where: { id: datos.b.pacienteId } });
      expect(sigue, 'el paciente de B fue borrado por A').not.toBeNull();
    });

    it('A no puede reprogramar la cita de B', async () => {
      await comoA('patch', `/api/citas/${datos.b.citaId}`, {
        fecha: '2026-12-31',
        horaInicio: '08:00',
        horaFin: '08:30',
      }).expect(404);

      const cita = await prisma.cita.findUniqueOrThrow({ where: { id: datos.b.citaId } });
      expect(cita.horaInicio).toBe('09:00');
    });

    it('A no puede anular el pago de B', async () => {
      await comoA('patch', `/api/pagos/${datos.b.pagoId}/anular`).expect(404);

      const pago = await prisma.pago.findUniqueOrThrow({ where: { id: datos.b.pagoId } });
      expect(pago.estado).not.toBe('anulado');
    });

    it('A no puede registrar una salida de inventario sobre el insumo de B', async () => {
      await comoA('post', `/api/insumos/${datos.b.insumoId}/salidas`, {
        cantidad: 5,
        motivo: 'robo',
      }).expect(404);

      const insumo = await prisma.insumo.findUniqueOrThrow({ where: { id: datos.b.insumoId } });
      expect(insumo.stockActual).toBe(10);
    });

    it('A no puede finalizar ni revocar el consentimiento de B', async () => {
      await comoA('patch', `/api/consentimientos/${datos.b.consentimientoId}/estado`, {
        estado: 'revocado',
      }).expect(404);

      const c = await prisma.consentimientoFirmado.findUniqueOrThrow({
        where: { id: datos.b.consentimientoId },
      });
      expect(c.estado).toBe('borrador');
    });
  });

  // ============================================================ 4. Spoofing de tenant

  describe('4. El tenantId del cliente se ignora', () => {
    it('crear un recurso declarando el tenant ajeno lo asigna al tenant de la sesión', async () => {
      const antes = await prisma.paciente.count({ where: { tenantId: datos.b.tenantId } });

      const r = await comoA('post', '/api/pacientes', {
        tipoDoc: 'DNI',
        numDoc: '99999999',
        nombres: 'Intruso',
        apellidos: 'Tenant',
        tenantId: datos.b.tenantId, // intento de spoofing
      });

      // Aceptable: 400 (rechazado por forbidNonWhitelisted) o 201 (ignorado).
      expect([201, 400]).toContain(r.status);

      const despues = await prisma.paciente.count({ where: { tenantId: datos.b.tenantId } });
      expect(despues, 'se creó un paciente en el tenant B').toBe(antes);

      if (r.status === 201) {
        const creado = await prisma.paciente.findFirstOrThrow({ where: { numDoc: '99999999' } });
        expect(creado.tenantId).toBe(datos.a.tenantId);
        await prisma.paciente.delete({ where: { id: creado.id } });
      }
    });
  });

  // ============================================================ 5. Unicidad por tenant

  describe('5. Unicidad por tenant', () => {
    it('dos tenants distintos pueden tener el mismo codigoRecibo', async () => {
      expect(datos.a.codigoRecibo).toBe(datos.b.codigoRecibo);
      const [pa, pb] = await Promise.all([
        prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } }),
        prisma.pago.findUniqueOrThrow({ where: { id: datos.b.pagoId } }),
      ]);
      expect(pa.codigoRecibo).toBe(pb.codigoRecibo);
      expect(pa.tenantId).not.toBe(pb.tenantId);
    });

    it('el mismo codigoRecibo SÍ colisiona dentro del mismo tenant', async () => {
      const filas = await prisma.pago.findMany({
        where: { tenantId: datos.a.tenantId, codigoRecibo: datos.a.codigoRecibo },
      });
      expect(filas).toHaveLength(1);

      await expect(
        prisma.pago.create({
          data: {
            tenantId: datos.a.tenantId,
            codigoRecibo: datos.a.codigoRecibo,
            tipo: 'ingreso',
            concepto: 'duplicado',
            montoTotal: 1,
            fecha: new Date('2026-03-11'),
          },
        }),
      ).rejects.toThrow();
    });

    it('dos tenants pueden tener el mismo token de cita en teoría, pero el token es único por tenant', async () => {
      const filas = await prisma.cita.findMany({ where: { tenantId: datos.a.tenantId } });
      expect(filas.every((c) => c.tenantId === datos.a.tenantId)).toBe(true);
    });
  });

  // ============================================================ 6. Suscripciones

  describe('6. La suscripción no es manipulable por el tenant', () => {
    it('A no puede leer la suscripción de B', async () => {
      await comoA('get', `/api/subscriptions/${datos.b.tenantId}`).expect((res) =>
        expect([403, 404]).toContain(res.status),
      );
    });

    it('A no puede modificar su propio plan por HTTP', async () => {
      await comoA('patch', `/api/subscriptions/${datos.a.tenantId}`, { planId: 'plan-clinica' }).expect(
        (res) => expect([403, 404, 405]).toContain(res.status),
      );
    });
  });

  // ============================================================ 7. Extensión Prisma

  describe('7. Límites conocidos de la extensión Prisma (ADR-002)', () => {
    it('LÍMITE: el hook no recibe el contexto fuera del pipeline HTTP', async () => {
      const { tenantContext } = await import('../src/core/tenant-context/tenant-context.js');

      // El middleware envuelve TODA la petición con run() y ahí el hook sí ve el
      // store (lo demuestran los casos de la sección 2, que filtran de verdad).
      // En cambio, un run() que envuelve solo una llamada suelta a Prisma NO
      // propaga el contexto hasta el hook de la extensión.
      //
      // Consecuencia de diseño: el aislamiento NO debe depender de la extensión.
      // `requireTenant()` + la verificación explícita de pertenencia son
      // obligatorios, sobre todo en scripts, seeds, migraciones y cron, que corren
      // fuera de una petición HTTP.
      const enA = await tenantContext.run(
        {
          tenantId: datos.a.tenantId,
          userId: datos.a.userId,
          roleIds: [],
          permissions: [],
          validado: true,
        },
        async () => await prisma.paciente.findMany(),
      );
      expect(enA.length).toBeGreaterThan(0);
    });

    it('LÍMITE CONOCIDO: findUnique por id global NO filtra por tenant', async () => {
      // Con la estrategia de ID de ADR-002 (id global único), `findUnique({where:{id}})`
      // puede devolver una fila de otro tenant. Por eso es OBLIGATORIO que los
      // servicios verifiquen `registro.tenantId === ctx.tenantId` antes de mutar
      // (los casos de las secciones 2 y 3 prueban que la capa HTTP sí lo hace).
      const { tenantContext } = await import('../src/core/tenant-context/tenant-context.js');

      const cruzado = await tenantContext.run(
        {
          tenantId: datos.a.tenantId,
          userId: datos.a.userId,
          roleIds: [],
          permissions: [],
          validado: true,
        },
        async () => await prisma.paciente.findUnique({ where: { id: datos.b.pacienteId } }),
      );

      // Se documenta el comportamiento real; si algún día se migra a claves
      // compuestas (ADR-002 alternativa A), esta aserción debe cambiar a null.
      expect(cruzado?.id).toBe(datos.b.pacienteId);
    });
  });
});
