/**
 * Catálogo de ejemplo (opt-in del panel, nunca automático).
 *
 * `POST /platform/tenants/:id/catalogo-ejemplo` carga en la clínica los
 * tratamientos de la fuente única (`CATALOGO_EJEMPLO_TRATAMIENTOS`), saltando
 * los que ya existen por nombre: pulsar dos veces no duplica, y lo que la
 * clínica creó a mano se respeta (precio incluido).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { CATALOGO_EJEMPLO_TRATAMIENTOS } from '../src/core/catalogo/ejemplo.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { INestApplication } from '@nestjs/common';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { loginPlataformaConMfa } from './helpers/platform-login.js';

const OWNER_EMAIL = 'owner-ejemplo@test.pe';
const OWNER_PASSWORD = 'Owner-Ejemplo-2026!';
const NOMBRES = CATALOGO_EJEMPLO_TRATAMIENTOS.map((t) => t.nombre);

type Db = {
  platformUser: {
    create: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformAuditLog: { deleteMany: (a: unknown) => Promise<unknown> };
};

describe('Catálogo de ejemplo del panel', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let adminH: Record<string, string>;
  let adminBH: Record<string, string>;
  let PH: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;
    await limpiarDosTenants(prisma);
    await db.platformAuditLog.deleteMany({});
    await db.platformUser.deleteMany({ where: { email: OWNER_EMAIL } });
    datos = await seedDosTenants(prisma);
    await db.platformUser.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash: await bcrypt.hash(OWNER_PASSWORD, 10),
        nombre: 'Owner Ejemplo',
        rol: 'owner',
      },
    });
    const sesion = await loginPlataformaConMfa(app.getHttpServer(), OWNER_EMAIL, OWNER_PASSWORD);
    PH = { Authorization: `Bearer ${sesion.access}` };
    const login = async (email: string, password: string, tenantId: string) => {
      const r = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email, password })
        .expect(200);
      return { Authorization: `Bearer ${r.body.access_token}`, 'X-Tenant-Id': tenantId } as Record<string, string>;
    };
    adminH = await login(datos.a.userEmail, PASSWORD_PLAIN, datos.a.tenantId);
    adminBH = await login(datos.b.userEmail, PASSWORD_PLAIN, datos.b.tenantId);
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      // Los tratamientos creados son tenant-scoped: los arrastra la cascada.
      await limpiarDosTenants(prisma);
      await db.platformAuditLog.deleteMany({});
      await db.platformUser.deleteMany({ where: { email: OWNER_EMAIL } });
    }
    if (app) await app.close();
  });

  const http = () => request(app.getHttpServer());
  const ruta = (tenantId: string) => `/api/platform/tenants/${tenantId}/catalogo-ejemplo`;

  it('sin token → 401; token de clínica → 401', async () => {
    await http().post(ruta(datos.a.tenantId)).expect(401);
    await http().post(ruta(datos.a.tenantId)).set(adminH).expect(401);
  });

  it('tenant inexistente → 404', async () => {
    await http().post(ruta('00000000-0000-4000-a000-000000000000')).set(PH).expect(404);
  });

  it('respeta lo que ya existe (nombre y precio de la clínica mandan)', async () => {
    // La clínica B ya tiene "su" Consulta dental a otro precio: el catálogo
    // no la pisa ni la duplica.
    await http()
      .post('/api/tratamientos')
      .set(adminBH)
      .send({ nombre: 'Consulta dental', precio: 999, duracionMin: 20 })
      .expect(201);
    const r = await http().post(ruta(datos.b.tenantId)).set(PH).expect(201);
    expect(r.body).toEqual({
      creados: CATALOGO_EJEMPLO_TRATAMIENTOS.length - 1,
      omitidos: 1,
    });
    const lista = await http().get('/api/tratamientos').set(adminBH).expect(200);
    const consulta = (lista.body as Array<{ nombre: string; precio: unknown }>).find(
      (t) => t.nombre === 'Consulta dental',
    );
    expect(Number(consulta!.precio)).toBe(999);
  });

  it('primera carga crea todo el catálogo; la segunda no duplica', async () => {
    const primera = await http().post(ruta(datos.a.tenantId)).set(PH).expect(201);
    expect(primera.body).toEqual({ creados: CATALOGO_EJEMPLO_TRATAMIENTOS.length, omitidos: 0 });

    const lista = await http().get('/api/tratamientos').set(adminH).expect(200);
    const nombres = new Set((lista.body as Array<{ nombre: string }>).map((t) => t.nombre));
    for (const n of NOMBRES) expect(nombres.has(n)).toBe(true);

    const segunda = await http().post(ruta(datos.a.tenantId)).set(PH).expect(201);
    expect(segunda.body).toEqual({ creados: 0, omitidos: CATALOGO_EJEMPLO_TRATAMIENTOS.length });
  });
});
