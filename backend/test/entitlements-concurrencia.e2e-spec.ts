/**
 * Concurrencia en los límites de plan (bug TOCTOU de `EntitlementsService`).
 *
 * El bug: `checkLimit` contaba el uso FUERA de la transacción y el llamador
 * insertaba después, así que N peticiones simultáneas leían el mismo uso y
 * todas pasaban el límite. La corrección (`crearConLimite`) toma un lock de
 * fila del tenant (`SELECT ... FOR UPDATE`) dentro de la misma transacción que
 * cuenta e inserta.
 *
 * Este spec lanza N `POST /api/sedes` a la vez con un plan de `max_sedes = 1`
 * y exige que gane EXACTAMENTE una: ni una más (que es el bug) ni ninguna
 * (que sería serializar de más o romper el caso legítimo).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import {
  PASSWORD_PLAIN,
  limpiarDosTenants,
  seedDosTenants,
  type DosTenants,
} from './helpers/tenants-fixture.js';
import { loginPlataformaConMfa } from './helpers/platform-login.js';

/** Peticiones `POST /api/sedes` disparadas en el mismo tick. */
const CONCURRENTES = 5;
/** Código de plan y owner propios del spec (no colisionan con los de `fase5`). */
const PLAN_CODIGO = 'concurrencia-max1';
const OWNER_EMAIL = 'owner-concurrencia@test.pe';
const OWNER_PASSWORD = 'Owner-Concurrencia-2026!';
const NOMBRE_SEDE = 'Sede concurrencia';

type Db = {
  plan: {
    create: (a: unknown) => Promise<{ id: string }>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  planFeature: { create: (a: unknown) => Promise<unknown> };
  subscription: { deleteMany: (a: unknown) => Promise<unknown> };
  platformUser: {
    create: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformAuditLog: { deleteMany: (a: unknown) => Promise<unknown> };
  sede: {
    updateMany: (a: unknown) => Promise<{ count: number }>;
    deleteMany: (a: unknown) => Promise<{ count: number }>;
    count: (a: unknown) => Promise<number>;
    findMany: (a: unknown) => Promise<Array<{ id: string; nombre: string }>>;
  };
};

describe('Concurrencia de límites de plan (entitlements)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let adminH: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;

    // Estado limpio (incluye restos de una ejecución interrumpida).
    await limpiarDosTenants(prisma);
    await db.subscription.deleteMany({ where: { tenantId: { startsWith: 'ta-' } } });
    await db.plan.deleteMany({ where: { codigo: PLAN_CODIGO } });
    await db.platformAuditLog.deleteMany({});
    await db.platformUser.deleteMany({ where: { email: OWNER_EMAIL } });

    datos = await seedDosTenants(prisma);
    const srv = app.getHttpServer();
    const login = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    adminH = {
      Authorization: `Bearer ${login.body.access_token}`,
      'X-Tenant-Id': datos.a.tenantId,
    };

    // Plan con `max_sedes = 1` (y `multi_sede` deshabilitada: la sede que se
    // creará es la primera del tenant y esa no exige la feature).
    const plan = await db.plan.create({
      data: { codigo: PLAN_CODIGO, nombre: 'Plan concurrencia', descripcion: '', precioMensual: 10 },
    });
    for (const f of [
      { clave: 'multi_sede', habilitado: false, limite: null },
      { clave: 'max_sedes', habilitado: true, limite: 1 },
      { clave: 'max_usuarios', habilitado: true, limite: 20 },
    ]) {
      await db.planFeature.create({ data: { planId: plan.id, ...f } });
    }

    // Suscripción por el flujo real de plataforma: el PUT invalida la caché de
    // entitlements, así que el plan recién creado se ve en la siguiente llamada.
    const hash = await bcrypt.hash(OWNER_PASSWORD, 10);
    await db.platformUser.create({
      data: { email: OWNER_EMAIL, passwordHash: hash, nombre: 'Owner concurrencia', rol: 'owner' },
    });
    const sesion = await loginPlataformaConMfa(srv, OWNER_EMAIL, OWNER_PASSWORD);
    await request(srv)
      .put('/api/platform/subscriptions')
      .set({ Authorization: `Bearer ${sesion.access}` })
      .send({ tenantId: datos.a.tenantId, planCodigo: PLAN_CODIGO })
      .expect(200);
  }, 120_000);

  afterAll(async () => {
    if (prisma && datos) {
      // Sedes creadas aquí (las demás dependencias caen con el prefijo `ta-`).
      await db.sede.deleteMany({
        where: { tenantId: datos.a.tenantId, nombre: { startsWith: NOMBRE_SEDE } },
      });
      await limpiarDosTenants(prisma);
      await db.subscription.deleteMany({ where: { tenantId: { startsWith: 'ta-' } } });
      await db.plan.deleteMany({ where: { codigo: PLAN_CODIGO } });
      await db.platformAuditLog.deleteMany({});
      await db.platformUser.deleteMany({ where: { email: OWNER_EMAIL } });
    }
    if (app) await app.close();
  });

  it('N POST /api/sedes concurrentes con max_sedes = 1: gana exactamente una', async () => {
    const srv = app.getHttpServer();

    // Punto de partida con uso 0. El fixture deja una sede por tenant y el plan
    // permite exactamente 1, así que se marca como borrada: la primera creación
    // es legítima (y única) en lugar de chocar ya con el límite. La carrera que
    // se prueba es entre las N peticiones, no contra la sede del fixture.
    const marcadas = await db.sede.updateMany({
      where: { tenantId: datos.a.tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    expect(marcadas.count).toBe(1);
    expect(await db.sede.count({ where: { tenantId: datos.a.tenantId, deletedAt: null } })).toBe(0);

    // Sin `await` individual: las N peticiones salen en el mismo tick, así que
    // sus transacciones se solapan en el tiempo.
    const respuestas = await Promise.all(
      Array.from({ length: CONCURRENTES }, (_, i) =>
        request(srv)
          .post('/api/sedes')
          .set(adminH)
          .send({ nombre: `${NOMBRE_SEDE} ${i + 1}` }),
      ),
    );

    const codigos = respuestas.map((r) => r.status);
    // Ningún 400/500 disfrazando una carrera mal resuelta.
    expect(codigos.filter((c) => c !== 201 && c !== 403)).toEqual([]);
    expect(codigos.filter((c) => c === 201)).toHaveLength(1);
    expect(codigos.filter((c) => c === 403)).toHaveLength(CONCURRENTES - 1);
    // El 403 lo produce el límite del plan, no un permiso ausente.
    for (const r of respuestas.filter((x) => x.status === 403)) {
      expect(String((r.body as { message?: string }).message ?? '')).toContain(
        'Límite del plan alcanzado',
      );
    }

    // En la base hay exactamente 1 sede no borrada para el tenant.
    const activas = await db.sede.findMany({
      where: { tenantId: datos.a.tenantId, deletedAt: null },
    });
    expect(activas).toHaveLength(1);
    expect(activas[0]!.nombre.startsWith(NOMBRE_SEDE)).toBe(true);
    // La del fixture sigue ahí (marcada como borrada): 1 + 1, sin filas de más.
    expect(await db.sede.count({ where: { tenantId: datos.a.tenantId } })).toBe(2);
  }, 120_000);
});
