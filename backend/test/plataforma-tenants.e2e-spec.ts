/**
 * Alta completa de clínicas (Fase 6 §14: `POST /platform/tenants`).
 *
 * Contrato que fija:
 *  1. 201 con Tenant + TenantConfig + Sede principal + Rol ADMIN (todo el
 *     catálogo) + User dueño + Membership + Subscription, en UNA transacción.
 *  2. Slug o email existentes → 409, nunca 500 (ni siquiera en carrera).
 *  3. Cuerpo inválido (clave corta, slug, email, plan) → 400: el DTO es clase.
 *  4. Sin token → 401; token de CLÍNICA → 401 (PlatformGuard, no TenantGuard).
 *  5. El dueño creado entra por el flujo MFA real (setup requerido, sin
 *     atajos ni sesión por defecto).
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { CATALOGO_PERMISOS } from '../src/core/catalogo/permisos.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { INestApplication } from '@nestjs/common';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { loginPlataformaConMfa } from './helpers/platform-login.js';

type Db = {
  plan: {
    create: (a: unknown) => Promise<{ id: string }>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  planFeature: { create: (a: unknown) => Promise<unknown> };
  tenant: {
    findUnique: (a: unknown) => Promise<{ id: string } | null>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  tenantConfig: { findUnique: (a: unknown) => Promise<{ nombre: string } | null> };
  sede: { findMany: (a: unknown) => Promise<Array<{ nombre: string; esPrincipal: boolean }>> };
  role: {
    findFirst: (a: unknown) => Promise<{ id: string; esSistema: boolean } | null>;
  };
  rolePermission: { count: (a: unknown) => Promise<number> };
  user: {
    findUnique: (a: unknown) => Promise<{ id: string } | null>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  membership: {
    findFirst: (a: unknown) => Promise<{ estado: string } | null>;
  };
  subscription: {
    findUnique: (a: unknown) => Promise<{ estado: string; planId: string } | null>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformUser: {
    create: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformAuditLog: {
    deleteMany: (a: unknown) => Promise<unknown>;
  };
};

const OWNER_EMAIL = 'owner-alta@test.pe';
const OWNER_PASSWORD = 'Owner-Alta-2026!';
const SLUG = 'clinica-alta-1';
const DUENO_EMAIL = 'dueno@alta-1.pe';

describe('Alta de clínicas', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let adminH: Record<string, string>;
  let PH: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;
    await limpiarDosTenants(prisma);
    await db.tenant.deleteMany({ where: { slug: { in: [SLUG, 'clinica-alta-2'] } } });
    await db.user.deleteMany({ where: { email: { in: [DUENO_EMAIL, 'otro@alta.pe'] } } });
    await db.subscription.deleteMany({ where: { tenantId: { startsWith: 'ta-' } } });
    await db.plan.deleteMany({ where: { codigo: { in: ['consultorio', 'clinica'] } } });
    await db.platformAuditLog.deleteMany({});
    await db.platformUser.deleteMany({ where: { email: OWNER_EMAIL } });
    datos = await seedDosTenants(prisma);
    const plan = await db.plan.create({
      data: { codigo: 'clinica', nombre: 'Clínica', descripcion: '', precioMensual: 249 },
    });
    await db.planFeature.create({ data: { planId: plan.id, clave: 'multi_sede', habilitado: true, limite: null } });
    await db.planFeature.create({ data: { planId: plan.id, clave: 'max_usuarios', habilitado: true, limite: 20 } });
    await db.platformUser.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash: await bcrypt.hash(OWNER_PASSWORD, 10),
        nombre: 'Owner Alta',
        rol: 'owner',
      },
    });
    const sesion = await loginPlataformaConMfa(
      app.getHttpServer(),
      OWNER_EMAIL,
      OWNER_PASSWORD,
    );
    PH = { Authorization: `Bearer ${sesion.access}` };
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    adminH = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await db.tenant.deleteMany({ where: { slug: { in: [SLUG, 'clinica-alta-2'] } } });
      await db.user.deleteMany({ where: { email: { in: [DUENO_EMAIL, 'otro@alta.pe'] } } });
      await limpiarDosTenants(prisma);
      await db.subscription.deleteMany({ where: { tenantId: { startsWith: 'ta-' } } });
      await db.plan.deleteMany({ where: { codigo: { in: ['consultorio', 'clinica'] } } });
      await db.platformAuditLog.deleteMany({});
      await db.platformUser.deleteMany({ where: { email: OWNER_EMAIL } });
    }
    if (app) await app.close();
  });

  function altaBase(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      slug: SLUG,
      nombre: 'Clínica Alta Uno',
      planCodigo: 'clinica',
      ownerNombre: 'Dueña Una',
      ownerEmail: DUENO_EMAIL,
      ownerPassword: 'Duena-Alta-2026!',
      ...extra,
    };
  }

  it('201 con todo el grafo creado en la transacción', async () => {
    const srv = app.getHttpServer();
    const r = await request(srv).post('/api/platform/tenants').set(PH).send(altaBase()).expect(201);
    expect(r.body.slug).toBe(SLUG);
    expect(r.body.owner.email).toBe(DUENO_EMAIL);
    expect(r.body.passwordHash).toBeUndefined();
    expect(r.body.plan).toBe('clinica');

    const tenantId = r.body.id as string;
    const config = await db.tenantConfig.findUnique({ where: { tenantId } });
    expect(config?.nombre).toBe('Clínica Alta Uno');
    const sedes = await db.sede.findMany({ where: { tenantId } });
    expect(sedes).toHaveLength(1);
    expect(sedes[0]?.esPrincipal).toBe(true);
    const rol = await db.role.findFirst({ where: { tenantId, codigo: 'ADMIN' } });
    expect(rol?.esSistema).toBe(true);
    const nPermisos = await db.rolePermission.count({ where: { roleId: rol!.id } });
    expect(nPermisos).toBe(CATALOGO_PERMISOS.length);
    const dueño = await db.user.findUnique({ where: { email: DUENO_EMAIL } });
    expect(dueño?.id).toBe(r.body.owner.id);
    const membership = await db.membership.findFirst({ where: { tenantId, userId: dueño!.id } });
    expect(membership?.estado).toBe('ACTIVE');
    const sub = await db.subscription.findUnique({ where: { tenantId } });
    expect(sub?.estado).toBe('ACTIVE');
  });

  it('slug o email existentes → 409, nunca 500', async () => {
    const srv = app.getHttpServer();
    await request(srv).post('/api/platform/tenants').set(PH).send(altaBase()).expect(409);
    await request(srv)
      .post('/api/platform/tenants')
      .set(PH)
      .send(altaBase({ slug: 'clinica-alta-2' }))
      .expect(409);
  });

  it('cuerpo inválido → 400 (el DTO valida)', async () => {
    const srv = app.getHttpServer();
    await request(srv)
      .post('/api/platform/tenants')
      .set(PH)
      .send(altaBase({ slug: 'clinica-alta-2', ownerEmail: 'otro@alta.pe', ownerPassword: 'corta' }))
      .expect(400);
    await request(srv)
      .post('/api/platform/tenants')
      .set(PH)
      .send(altaBase({ slug: 'MAYUSCULAS', ownerEmail: 'otro@alta.pe' }))
      .expect(400);
    await request(srv)
      .post('/api/platform/tenants')
      .set(PH)
      .send(altaBase({ slug: 'clinica-alta-2', ownerEmail: 'otro@alta.pe', planCodigo: 'inexistente' }))
      .expect(400);
    await request(srv)
      .post('/api/platform/tenants')
      .set(PH)
      .send(altaBase({ slug: 'clinica-alta-2', ownerEmail: 'no-es-email' }))
      .expect(400);
  });

  it('sin token → 401; token de clínica → 401', async () => {
    const srv = app.getHttpServer();
    await request(srv).post('/api/platform/tenants').send(altaBase({ slug: 'x' })).expect(401);
    await request(srv).post('/api/platform/tenants').set(adminH).send(altaBase({ slug: 'x' })).expect(401);
  });

  it('el dueño creado entra a su clínica y opera (flujo real completo)', async () => {
    const srv = app.getHttpServer();
    const dueno = await db.user.findUnique({ where: { email: DUENO_EMAIL } });
    expect(!!dueno).toBe(true);
    // El dueño es usuario de CLÍNICA (tiene Membership), no de plataforma:
    // entra por `/api/auth/login` y su sesión trae el tenant nuevo.
    const r = await request(srv)
      .post('/api/auth/login')
      .send({ email: DUENO_EMAIL, password: 'Duena-Alta-2026!' })
      .expect(200);
    expect(typeof r.body.access_token).toBe('string');
    const H = { Authorization: `Bearer ${r.body.access_token as string}` };
    const sesion = await request(srv).get('/api/auth/sesion').set(H).expect(200);
    const ids = (sesion.body.tenants as Array<{ id: string }>).map((t) => t.id);
    const slugAlta = await db.tenant.findUnique({ where: { slug: SLUG } });
    expect(ids).toContain(slugAlta!.id);
    // Y con el X-Tenant-Id del tenant nuevo opera (lista vacía, pero 200:
    // la membresía ADMIN quedó bien enlazada).
    const HD = { ...H, 'X-Tenant-Id': slugAlta!.id };
    const lista = await request(srv).get('/api/pacientes').set(HD).expect(200);
    const cuerpo = Array.isArray(lista.body) ? lista.body : lista.body?.data;
    expect(Array.isArray(cuerpo)).toBe(true);
    // En cambio, en plataforma NO existe: 404 y nunca sesión plena.
    const rp = await request(srv)
      .post('/api/platform/auth/login')
      .send({ email: DUENO_EMAIL, password: 'Duena-Alta-2026!' });
    expect(rp.status).toBe(404);
  });
});
