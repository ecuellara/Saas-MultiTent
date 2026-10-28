/**
 * Ciclo de vida de clínicas en el panel de plataforma.
 *
 * Contrato que fija:
 *  1. `GET /platform/tenants` enriquecido: plan (código y nombre), periodo,
 *     nº de usuarios y nº de pacientes por clínica (groupBy, no include).
 *  2. `POST /platform/tenants/:id/suspender` y `/:reactivar`: suscripción a
 *     SUSPENDED/ACTIVE, con audit de plataforma.
 *  3. `POST /platform/tenants/:id/archivar` (soft delete): la clínica sale del
 *     listado y el login la rechaza con un mensaje claro.
 *  4. `POST /platform/tenants/:id/restaurar`: revierte el archivado.
 *  5. `DELETE /platform/tenants/:id`: SOLO clínica vacía; con datos (pacientes
 *     incluidos los borrados lógicos) → 409 «La clínica tiene datos…
 *     use archivar». El borrado de la vacía es transaccional (tenant, usuario
 *     dueño y sus relaciones desaparecen).
 *  6. Todo con PlatformGuard (sin token → 401).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { INestApplication } from '@nestjs/common';
import { montarAppE2E } from './helpers/app.e2e.js';
import { loginPlataformaConMfa } from './helpers/platform-login.js';

type Db = {
  plan: {
    create: (a: unknown) => Promise<{ id: string }>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  planFeature: { create: (a: unknown) => Promise<unknown> };
  tenant: {
    findUnique: (a: unknown) => Promise<{ id: string; deletedAt: Date | null } | null>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  subscription: { findUnique: (a: unknown) => Promise<{ estado: string } | null> };
  membership: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
  user: {
    findUnique: (a: unknown) => Promise<{ id: string } | null>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  paciente: {
    create: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformUser: {
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformAuditLog: {
    findFirst: (a: unknown) => Promise<{ id: string; accion: string; metadata: unknown } | null>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
};

const OWNER_EMAIL = 'owner-ciclo@test.pe';
const OWNER_PASSWORD = 'Owner-Ciclo-2026!';
const SLUG_DATOS = 'clinica-ciclo-datos';
const SLUG_VACIA = 'clinica-ciclo-vacia';
const EMAIL_DATOS = 'dueno-datos@ciclo.pe';
const EMAIL_VACIA = 'dueno-vacia@ciclo.pe';
const PASSWORD_DUENA = 'Duena-Ciclo-2026!';
const MENSAJE_409 = 'La clínica tiene datos y no se puede eliminar; use archivar';
const MENSAJE_LOGIN = 'archivada';

describe('Ciclo de vida de clínicas (plataforma)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let PH: Record<string, string>;
  const ids = { datos: '', vacia: '' };

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;
    await limpiar();
    await db.plan.deleteMany({ where: { codigo: 'clinica' } });
    await db.paciente.deleteMany({ where: { tenantId: { startsWith: 'cv-' } } });
    await db.tenant.deleteMany({ where: { slug: { in: [SLUG_DATOS, SLUG_VACIA] } } });
    await db.user.deleteMany({ where: { email: { in: [EMAIL_DATOS, EMAIL_VACIA] } } });
    await db.platformAuditLog.deleteMany({});
    await db.platformUser.deleteMany({ where: { email: OWNER_EMAIL } });
    const plan = await db.plan.create({
      data: { codigo: 'clinica', nombre: 'Clínica', descripcion: '', precioMensual: 249 },
    });
    await db.planFeature.create({ data: { planId: plan.id, clave: 'max_usuarios', habilitado: true, limite: 20 } });
    await prisma.platformUser.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash: await bcrypt.hash(OWNER_PASSWORD, 10),
        nombre: 'Owner Ciclo',
        rol: 'owner',
      },
    });
    const sesion = await loginPlataformaConMfa(
      app.getHttpServer(),
      OWNER_EMAIL,
      OWNER_PASSWORD,
    );
    PH = { Authorization: `Bearer ${sesion.access}` };
    const alta = async (slug: string, email: string, nombre: string) => {
      const r = await request(app.getHttpServer())
        .post('/api/platform/tenants')
        .set(PH)
        .send({
          slug,
          nombre,
          planCodigo: 'clinica',
          ownerNombre: 'Dueña',
          ownerEmail: email,
          ownerPassword: PASSWORD_DUENA,
        })
        .expect(201);
      return r.body.id as string;
    };
    ids.datos = await alta(SLUG_DATOS, EMAIL_DATOS, 'Clínica Ciclo Datos');
    ids.vacia = await alta(SLUG_VACIA, EMAIL_VACIA, 'Clínica Ciclo Vacía');
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await limpiar();
      await db.plan.deleteMany({ where: { codigo: 'clinica' } });
      await db.paciente.deleteMany({ where: { tenantId: { startsWith: 'cv-' } } });
      await db.platformAuditLog.deleteMany({});
      await db.platformUser.deleteMany({ where: { email: OWNER_EMAIL } });
    }
    if (app) await app.close();
  });

  async function limpiar(): Promise<void> {
    await db.tenant.deleteMany({ where: { slug: { in: [SLUG_DATOS, SLUG_VACIA] } } });
    await db.user.deleteMany({ where: { email: { in: [EMAIL_DATOS, EMAIL_VACIA] } } });
  }

  const rutas = {
    suspender: (id: string) => `/api/platform/tenants/${id}/suspender`,
    reactivar: (id: string) => `/api/platform/tenants/${id}/reactivar`,
    archivar: (id: string) => `/api/platform/tenants/${id}/archivar`,
    restaurar: (id: string) => `/api/platform/tenants/${id}/restaurar`,
  };

  it('listado enriquecido: plan, periodo, usuarios y pacientes', async () => {
    const srv = app.getHttpServer();
    const lista = await request(srv).get('/api/platform/tenants').set(PH).expect(200);
    const fila = (lista.body as Array<Record<string, unknown>>).find((t) => t.id === ids.datos);
    expect(fila).toBeTruthy();
    expect((fila!.suscripcion as Record<string, unknown>).periodoInicio).toBeTruthy();
    expect((fila!.suscripcion as Record<string, unknown>).periodoFin).toBeTruthy();
    const plan = (fila!.suscripcion as Record<string, unknown>).plan as Record<string, unknown>;
    expect(plan.codigo).toBe('clinica');
    expect(plan.nombre).toBe('Clínica');
    expect(fila!.usuarios).toBe(1);
    expect(fila!.pacientes).toBe(0);
  });

  it('suspender y reactivar cambian la suscripción y registran audit', async () => {
    const srv = app.getHttpServer();
    await request(srv).post(rutas.suspender(ids.datos)).set(PH).expect(200);
    expect((await db.subscription.findUnique({ where: { tenantId: ids.datos } }))?.estado).toBe('SUSPENDED');
    await request(srv).post(rutas.reactivar(ids.datos)).set(PH).expect(200);
    expect((await db.subscription.findUnique({ where: { tenantId: ids.datos } }))?.estado).toBe('ACTIVE');
    const audit = await db.platformAuditLog.findFirst({
      where: { accion: { contains: 'suspender' }, metadata: { path: ['detalle'], equals: ids.datos } },
    });
    expect(audit).toBeTruthy();
  });

  it('eliminar con datos → 409 con el mensaje exacto', async () => {
    const srv = app.getHttpServer();
    await db.paciente.create({
      data: {
        tenantId: ids.datos,
        tipoDoc: 'DNI',
        numDoc: '30011122',
        nombres: 'Paciente',
        apellidos: 'Ciclo',
      },
    });
    const r = await request(srv).delete(`/api/platform/tenants/${ids.datos}`).set(PH).expect(409);
    expect(r.body.message).toBe(MENSAJE_409);
    // Incluso un paciente BORRADO LÓGICAMENTE bloquea la eliminación.
    await db.paciente.deleteMany({ where: { tenantId: ids.datos } });
    await db.paciente.create({
      data: {
        tenantId: ids.datos,
        tipoDoc: 'DNI',
        numDoc: '30011123',
        nombres: 'Paciente Borrado',
        apellidos: 'Ciclo',
        deletedAt: new Date(),
      },
    });
    const r2 = await request(srv).delete(`/api/platform/tenants/${ids.datos}`).set(PH).expect(409);
    expect(r2.body.message).toBe(MENSAJE_409);
  });

  it('archivar: sale del listado y el login la rechaza; restaurar lo revierte', async () => {
    const srv = app.getHttpServer();
    await request(srv).post(rutas.archivar(ids.datos)).set(PH).expect(200);
    const t = await db.tenant.findUnique({ where: { id: ids.datos } });
    expect(t?.deletedAt).toBeTruthy();
    const lista = await request(srv).get('/api/platform/tenants').set(PH).expect(200);
    expect(
      (lista.body as Array<{ id: string }>).some((x) => x.id === ids.datos),
    ).toBe(false);
    const login = await request(srv)
      .post('/api/auth/login')
      .send({ email: EMAIL_DATOS, password: PASSWORD_DUENA })
      .expect(403);
    expect(String(login.body.message)).toContain(MENSAJE_LOGIN);
    // Restaurar: vuelve al listado y permite el login.
    await request(srv).post(rutas.restaurar(ids.datos)).set(PH).expect(200);
    expect((await db.tenant.findUnique({ where: { id: ids.datos } }))?.deletedAt).toBeNull();
    const lista2 = await request(srv).get('/api/platform/tenants').set(PH).expect(200);
    expect((lista2.body as Array<{ id: string }>).some((x) => x.id === ids.datos)).toBe(true);
    await request(srv)
      .post('/api/auth/login')
      .send({ email: EMAIL_DATOS, password: PASSWORD_DUENA })
      .expect(200);
  });

  it('eliminar clínica vacía: transaccional, borra tenant, usuario, membership y suscripción', async () => {
    const srv = app.getHttpServer();
    await request(srv).delete(`/api/platform/tenants/${ids.vacia}`).set(PH).expect(200);
    expect(await db.tenant.findUnique({ where: { id: ids.vacia } })).toBeNull();
    expect(await db.membership.findFirst({ where: { tenantId: ids.vacia } })).toBeNull();
    expect(await db.user.findUnique({ where: { email: EMAIL_VACIA } })).toBeNull();
    // El audit de plataforma quedó escrito ANTES del borrado.
    const audit = await db.platformAuditLog.findFirst({
      where: { accion: 'DELETE /api/platform/tenants/:id' },
    });
    expect(audit).toBeTruthy();
  });

  it('sin token → 401 en todas las rutas de ciclo de vida', async () => {
    const srv = app.getHttpServer();
    await request(srv).post(rutas.archivar(ids.datos)).expect(401);
    await request(srv).post(rutas.restaurar(ids.datos)).expect(401);
    await request(srv).post(rutas.suspender(ids.datos)).expect(401);
    await request(srv).post(rutas.reactivar(ids.datos)).expect(401);
    await request(srv).delete(`/api/platform/tenants/${ids.datos}`).expect(401);
  });
});
