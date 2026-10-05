/**
 * Numeración por tenant y trazabilidad del odontograma.
 *
 * Cubre dos correcciones concretas:
 *  1. Secuencias: `count+1` reutilizaba números ya emitidos cuando había huecos,
 *     y el token de cita se truncaba a `CIT-0001AB` (solo 2 caracteres
 *     aleatorios, enumerable).
 *  2. Odontograma: hallazgo y evento se creaban en dos escrituras sueltas,
 *     `estadoAnterior` nunca se rellenaba y no existía forma de anular un
 *     hallazgo ("anular ≠ borrar" estaba a medias).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

type Evento = { id: string; pieza: string; estadoAnterior: string | null; estadoNuevo: string };
type Hallazgo = { id: string; activo: boolean; tenantId: string };

type Db = {
  pago: {
    findMany: (a: unknown) => Promise<Array<{ id: string; codigoRecibo: string }>>;
    delete: (a: unknown) => Promise<unknown>;
    count: (a: unknown) => Promise<number>;
  };
  cita: { findUnique: (a: unknown) => Promise<{ token: string } | null> };
  odontogramaEvento: { findMany: (a: unknown) => Promise<Evento[]> };
  odontogramaHallazgo: { findUnique: (a: unknown) => Promise<Hallazgo | null> };
};

describe('Secuencias por tenant y trazabilidad del odontograma', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let H: Record<string, string>;
  let HB: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;

    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    const srv = app.getHttpServer();
    const loginA = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    H = { Authorization: `Bearer ${loginA.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };

    const loginB = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.b.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    HB = { Authorization: `Bearer ${loginB.body.access_token}`, 'X-Tenant-Id': datos.b.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) await limpiarDosTenants(prisma);
    if (app) await app.close();
  });

  // ------------------------------------------------------------- secuencias

  it('el token de cita es opaco y con entropía suficiente (no enumerable)', async () => {
    const srv = app.getHttpServer();
    const tokens = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const r = await request(srv)
        .post('/api/citas')
        .set(H)
        .send({
          pacienteId: datos.a.pacienteId,
          fecha: '2026-06-15',
          horaInicio: `${String(8 + i).padStart(2, '0')}:00`,
          horaFin: `${String(8 + i).padStart(2, '0')}:30`,
        })
        .expect(201);
      const token = String(r.body.token ?? '');
      // Sin parte secuencial: 'CIT-' + 8 hex (el formato anterior era
      // CIT-0001AB, es decir un prefijo enumerable y 2 caracteres aleatorios).
      expect(token, `token inesperado: ${token}`).toMatch(/^CIT-[0-9A-F]{8}$/);
      tokens.add(token);
    }
    expect(tokens.size).toBe(3);
  });

  it('un hueco en la numeración no reutiliza un código ya emitido', async () => {
    const srv = app.getHttpServer();
    const crear = async (): Promise<string> => {
      const r = await request(srv)
        .post('/api/pagos')
        .set(H)
        .send({ concepto: 'Numeración', tipo: 'ingreso', montoTotal: 10 })
        .expect(201);
      return String(r.body.codigoRecibo);
    };

    const c1 = await crear();
    const c2 = await crear();
    const c3 = await crear();
    const n = (c: string): number => Number.parseInt(c.split('-')[2] ?? '0', 10);
    expect([n(c2), n(c3)]).toEqual([n(c1) + 1, n(c1) + 2]);

    // Se elimina el intermedio: quedan 0001 y 0003. Con `count+1` el siguiente
    // habría sido 0003 otra vez (ya emitido) y la creación fallaba con 409.
    const pagos = (await db.pago.findMany({
      where: { tenantId: datos.a.tenantId },
    })) as Array<{ id: string; codigoRecibo: string }>;
    const objetivo = pagos.find((p) => p.codigoRecibo === c2);
    expect(objetivo, 'no se encontró el recibo intermedio').toBeTruthy();
    await db.pago.delete({ where: { id: objetivo!.id } });

    const c4 = await crear();
    expect(n(c4)).toBe(n(c3) + 1);
    expect([c1, c2, c3]).not.toContain(c4);
  });

  // ------------------------------------------------------------ odontograma

  it('registrar un hallazgo escribe hallazgo y evento de forma consistente', async () => {
    await request(app.getHttpServer())
      .post(`/api/odontogramas/${datos.a.odontogramaId}/hallazgos`)
      .set(H)
      .send({ pieza: '26', hallazgoCodigo: 'CARIES', superficies: ['O'] })
      .expect(201);

    const eventos = await db.odontogramaEvento.findMany({
      where: { odontogramaId: datos.a.odontogramaId, pieza: '26' },
    });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.estadoNuevo).toBe('CARIES');
  });

  it('el segundo hallazgo de la pieza rellena `estadoAnterior`', async () => {
    await request(app.getHttpServer())
      .post(`/api/odontogramas/${datos.a.odontogramaId}/hallazgos`)
      .set(H)
      .send({ pieza: '26', hallazgoCodigo: 'CARIES', superficies: ['M'] })
      .expect(201);

    const eventos = await db.odontogramaEvento.findMany({
      where: { odontogramaId: datos.a.odontogramaId, pieza: '26' },
    });
    // El bug: `estadoAnterior` quedaba SIEMPRE en null, así que el historial
    // NTS 188 no reflejaba ninguna transición.
    const conAnterior = eventos.filter((e) => e.estadoAnterior !== null);
    expect(eventos).toHaveLength(2);
    expect(conAnterior).toHaveLength(1);
    expect(conAnterior[0]!.estadoAnterior).toBe('CARIES');
  });

  it('anular un hallazgo lo marca inactivo y deja traza (anular ≠ borrar)', async () => {
    const creado = await request(app.getHttpServer())
      .post(`/api/odontogramas/${datos.a.odontogramaId}/hallazgos`)
      .set(H)
      .send({ pieza: '27', hallazgoCodigo: 'CARIES', superficies: ['O'] })
      .expect(201);
    const hallazgoId = String(creado.body.id);

    await request(app.getHttpServer())
      .patch(`/api/odontogramas/${datos.a.odontogramaId}/hallazgos/${hallazgoId}/anular`)
      .set(H)
      .expect(200);

    const h = await db.odontogramaHallazgo.findUnique({ where: { id: hallazgoId } });
    expect(h, 'el hallazgo desapareció: debía anularse, no borrarse').not.toBeNull();
    expect(h!.activo).toBe(false);

    const eventos = await db.odontogramaEvento.findMany({
      where: { odontogramaId: datos.a.odontogramaId, pieza: '27' },
    });
    expect(eventos.some((e) => e.estadoNuevo === 'anulado')).toBe(true);
  });

  it('aislamiento: el tenant A no puede anular un hallazgo del tenant B', async () => {
    await request(app.getHttpServer())
      .patch(`/api/odontogramas/${datos.b.odontogramaId}/hallazgos/${datos.b.hallazgoId}/anular`)
      .set(H)
      .expect(404);

    const hB = await db.odontogramaHallazgo.findUnique({ where: { id: datos.b.hallazgoId } });
    expect(hB!.activo, 'el hallazgo del tenant B fue modificado').toBe(true);
  });
});
