/**
 * GET /api/auth/sesion — contrato de sesión que faltaba para el frontend.
 *
 * Contexto del bloqueo: el login devuelve SOLO `access_token` y el tenant activo
 * no viaja en el JWT (ADR-005), así que el cliente no tenía forma de saber quién
 * es, a qué clínicas pertenece ni qué puede hacer en cada una (`GET /memberships`
 * es por tenant y exige `X-Tenant-Id` + `members.manage`: huevo y gallina).
 *
 * Cobertura:
 *  1. Sin token → 401 (la ruta NO es `@Public`).
 *  2. Sin `X-Tenant-Id` → 200 con `usuario`, `tenants` (rol y slug) y
 *     `activo: null`, que es el caso del selector de clínica.
 *  3. Con `X-Tenant-Id` válido → `activo` con rol, TODOS los permisos del rol y
 *     las features de la suscripción real.
 *  3b. Un usuario en DOS clínicas ve ambas aunque declare una activa (la lista
 *     `tenants` no se recorta a la clínica de la cabecera).
 *  4. `X-Tenant-Id` de una clínica ajena → 403 (el vínculo, no un recurso).
 *  5. `X-Tenant-Id` inexistente → 403.
 *  6. La respuesta no filtra `passwordHash` ni `mfaSecret` (ni como clave ni
 *     como valor) ni tokens.
 *  7. Un usuario sin membresías → `tenants: []` y `activo: null`, sin error.
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
  PERMISOS_BASE,
  limpiarDosTenants,
  seedDosTenants,
  type DosTenants,
} from './helpers/tenants-fixture.js';

const PLAN_CODIGO = 'sesion-test';
const EMAIL_SIN_MEMBRESIAS = 'sesion-sin-clinica@test.pe';
const ID_SIN_MEMBRESIAS = 'sesion-user-sin-membresias';
const EMAIL_DOS_CLINICAS = 'sesion-dos-clinicas@test.pe';
const ID_DOS_CLINICAS = 'sesion-user-dos-clinicas';
const TENANT_INEXISTENTE = 'clinica-que-no-existe';
/** Secreto MFA REAL en la fila del usuario: si se filtrara, se vería aquí. */
const MFA_SECRETO = 'MFA-SECRETO-QUE-NO-DEBE-SALIR-2026';

type Db = {
  user: {
    create: (a: unknown) => Promise<{ id: string }>;
    update: (a: unknown) => Promise<unknown>;
    findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  plan: {
    create: (a: unknown) => Promise<{ id: string }>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  planFeature: { create: (a: unknown) => Promise<unknown> };
  subscription: {
    create: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
};

/** Claves exactas del contrato: ni un campo de más (por ahí se cuelan secretos). */
const CLAVES_RAIZ = ['activo', 'tenants', 'usuario'];
const CLAVES_USUARIO = ['cop', 'email', 'id', 'nombre'];
const CLAVES_TENANT = ['id', 'nombre', 'rol', 'sedeId', 'slug'];
const CLAVES_ACTIVO = ['features', 'permissions', 'rol', 'sedeId', 'tenantId'];

describe('GET /api/auth/sesion (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let tokenA: string;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;

    // Estado limpio antes de sembrar. Los usuarios extra de este spec no llevan
    // el prefijo del fixture (`ta-`/`tb-`), así que `limpiarDosTenants` no los
    // borra: se limpian aquí y en el `afterAll`.
    await limpiarDosTenants(prisma);
    await db.user.deleteMany({ where: { id: { in: [ID_SIN_MEMBRESIAS, ID_DOS_CLINICAS] } } });
    await db.subscription.deleteMany({ where: { tenantId: { startsWith: 'ta-' } } });
    await db.plan.deleteMany({ where: { codigo: PLAN_CODIGO } });

    datos = await seedDosTenants(prisma);

    // MFA real en la fila del usuario A: la comprobación de "sin secretos" tiene
    // que tener algo que podría filtrarse y no lo hace.
    await db.user.update({ where: { id: datos.a.userId }, data: { mfaSecret: MFA_SECRETO } });

    // Suscripción real de la clínica A: las `features` deben salir de
    // `EntitlementsService.resolver`, no de un objeto vacío por casualidad.
    const plan = await db.plan.create({
      data: { codigo: PLAN_CODIGO, nombre: 'Plan de pruebas de sesión', precioMensual: 10 },
    });
    for (const f of [
      { clave: 'agenda', habilitado: true, limite: null },
      { clave: 'max_sedes', habilitado: true, limite: 3 },
      { clave: 'reportes_avanzados', habilitado: false, limite: null },
    ]) {
      await db.planFeature.create({ data: { planId: plan.id, ...f } });
    }
    await db.subscription.create({
      data: {
        tenantId: datos.a.tenantId,
        planId: plan.id,
        estado: 'ACTIVE',
        periodoInicio: new Date('2026-01-01T00:00:00.000Z'),
        periodoFin: new Date('2027-01-01T00:00:00.000Z'),
      },
    });

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    tokenA = login.body.access_token as string;
    expect(tokenA, 'el login no devolvió access_token').toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await limpiarDosTenants(prisma);
      await db.user.deleteMany({ where: { id: { in: [ID_SIN_MEMBRESIAS, ID_DOS_CLINICAS] } } });
      // La suscripción cae con el tenant; el plan (FK sin cascada) solo después.
      await db.subscription.deleteMany({ where: { tenantId: { startsWith: 'ta-' } } });
      await db.plan.deleteMany({ where: { codigo: PLAN_CODIGO } });
    }
    if (app) await app.close();
  });

  it('1. sin token → 401 (la ruta NO es pública)', async () => {
    const srv = app.getHttpServer();
    await request(srv).get('/api/auth/sesion').expect(401);
    // Un token que no verifica no sirve.
    await request(srv)
      .get('/api/auth/sesion')
      .set({ Authorization: 'Bearer token-que-no-verifica' })
      .expect(401);
    // Ni declarando una clínica válida: `JwtAuthGuard` corre ANTES que el guard
    // de tenant, así que la falta de token no se convierte en 400/403.
    await request(srv)
      .get('/api/auth/sesion')
      .set({ 'X-Tenant-Id': datos.a.tenantId })
      .expect(401);
  });

  it('2. sin X-Tenant-Id → 200 con usuario, sus clínicas y activo null', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/auth/sesion')
      .set({ Authorization: `Bearer ${tokenA}` })
      .expect(200);

    expect(Object.keys(r.body).sort()).toEqual(CLAVES_RAIZ);
    expect(r.body.usuario).toEqual({
      id: datos.a.userId,
      email: datos.a.userEmail,
      nombre: 'Admin Clínica A',
      cop: null,
    });
    // Sin cabecera no hay clínica activa: el frontend muestra el selector.
    expect(r.body.activo, 'sin cabecera `activo` debe ser null').toBeNull();

    // El fixture deja al usuario A como miembro SOLO de la clínica A.
    const tenants = r.body.tenants as Array<Record<string, unknown>>;
    expect(tenants.map((t) => t.id)).toEqual([datos.a.tenantId]);
    expect(Object.keys(tenants[0]!).sort()).toEqual(CLAVES_TENANT);
    expect(tenants[0]!.nombre).toBe('Clínica A');
    expect(tenants[0]!.slug).toBe(datos.a.slug);
    expect(tenants[0]!.rol).toBe('ADMIN');
    expect(tenants[0]!.sedeId).toBe(datos.a.sedeId);
  });

  it('3. con X-Tenant-Id válido → activo con rol, permisos y features', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/auth/sesion')
      .set({ Authorization: `Bearer ${tokenA}`, 'X-Tenant-Id': datos.a.tenantId })
      .expect(200);

    const activo = r.body.activo as Record<string, unknown>;
    expect(activo, 'con cabecera válida `activo` debe venir poblado').toBeTruthy();
    expect(Object.keys(activo).sort()).toEqual(CLAVES_ACTIVO);
    expect(activo.tenantId).toBe(datos.a.tenantId);
    expect(activo.rol).toBe('ADMIN');
    expect(activo.sedeId).toBe(datos.a.sedeId);

    // El rol ADMIN del fixture tiene TODO el catálogo: ni una lista vacía ni una
    // recortada pasan esta aserción.
    const permisos = activo.permissions as string[];
    expect(permisos).toHaveLength(PERMISOS_BASE.length);
    for (const p of PERMISOS_BASE) expect(permisos).toContain(p.codigo);

    // `features` viene del plan + suscripción reales de la clínica A.
    expect(activo.features).toEqual({
      agenda: { habilitado: true, limite: null },
      max_sedes: { habilitado: true, limite: 3 },
      reportes_avanzados: { habilitado: false, limite: null },
    });

    // La lista de clínicas sigue completa al declarar la clínica activa.
    expect((r.body.tenants as Array<{ id: string }>).map((t) => t.id)).toEqual([datos.a.tenantId]);
  });

  it('3b. un usuario en DOS clínicas las ve ambas aunque declare una activa', async () => {
    const srv = app.getHttpServer();
    await db.user.create({
      data: {
        id: ID_DOS_CLINICAS,
        email: EMAIL_DOS_CLINICAS,
        passwordHash: await bcrypt.hash(PASSWORD_PLAIN, 10),
        nombre: 'Usuario Dos Clínicas',
        memberships: {
          create: [
            { tenantId: datos.a.tenantId, roleId: datos.a.roleId, sedeId: datos.a.sedeId },
            { tenantId: datos.b.tenantId, roleId: datos.b.roleId, sedeId: datos.b.sedeId },
          ],
        },
      },
    });
    const login = await request(srv)
      .post('/api/auth/login')
      .send({ email: EMAIL_DOS_CLINICAS, password: PASSWORD_PLAIN })
      .expect(200);
    const H = { Authorization: `Bearer ${login.body.access_token as string}` };

    const r = await request(srv)
      .get('/api/auth/sesion')
      .set({ ...H, 'X-Tenant-Id': datos.a.tenantId })
      .expect(200);

    // La clínica activa es A, pero el selector necesita ver AMBAS: la lista no
    // puede recortarse a la clínica de la cabecera.
    expect((r.body.tenants as Array<{ id: string }>).map((t) => t.id).sort()).toEqual(
      [datos.a.tenantId, datos.b.tenantId].sort(),
    );
    expect((r.body.activo as { tenantId: string }).tenantId).toBe(datos.a.tenantId);
    expect((r.body.activo as { sedeId: string }).sedeId).toBe(datos.a.sedeId);

    // Con la otra clínica activa, el `activo` es el de ESA clínica.
    const r2 = await request(srv)
      .get('/api/auth/sesion')
      .set({ ...H, 'X-Tenant-Id': datos.b.tenantId })
      .expect(200);
    expect((r2.body.activo as { tenantId: string }).tenantId).toBe(datos.b.tenantId);
    expect((r2.body.activo as { sedeId: string }).sedeId).toBe(datos.b.sedeId);
  });

  it('4. con X-Tenant-Id de una clínica ajena → 403 (no 404)', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/auth/sesion')
      .set({ Authorization: `Bearer ${tokenA}`, 'X-Tenant-Id': datos.b.tenantId })
      .expect(403);

    expect((r.body as { statusCode?: number }).statusCode).toBe(403);
    // Un 403 no puede traer datos de la clínica ajena ni un contrato a medias.
    expect(JSON.stringify(r.body)).not.toContain(datos.b.tenantId);
    expect(r.body).not.toHaveProperty('activo');
    expect(r.body).not.toHaveProperty('tenants');
  });

  it('5. con X-Tenant-Id inexistente → 403', async () => {
    const r = await request(app.getHttpServer())
      .get('/api/auth/sesion')
      .set({ Authorization: `Bearer ${tokenA}`, 'X-Tenant-Id': TENANT_INEXISTENTE })
      .expect(403);

    expect((r.body as { statusCode?: number }).statusCode).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain(TENANT_INEXISTENTE);
  });

  it('6. la respuesta no filtra passwordHash, mfaSecret ni tokens', async () => {
    const srv = app.getHttpServer();
    const fila = await db.user.findUnique({ where: { id: datos.a.userId } });
    expect(fila, 'el fixture no dejó al usuario A').toBeTruthy();
    const passwordHash = String(fila!.passwordHash);
    expect(passwordHash.length, 'el fixture no dejó hash de clave').toBeGreaterThan(20);
    expect(fila!.mfaSecret, 'la fila no tiene secreto MFA que pudiera filtrarse').toBe(MFA_SECRETO);

    const sinCabecera = await request(srv)
      .get('/api/auth/sesion')
      .set({ Authorization: `Bearer ${tokenA}` })
      .expect(200);
    const conCabecera = await request(srv)
      .get('/api/auth/sesion')
      .set({ Authorization: `Bearer ${tokenA}`, 'X-Tenant-Id': datos.a.tenantId })
      .expect(200);

    for (const r of [sinCabecera, conCabecera]) {
      const crudo = JSON.stringify(r.body);
      // Ni el valor (hash / secreto) ni el nombre de la columna.
      expect(crudo).not.toContain(passwordHash);
      expect(crudo).not.toContain(MFA_SECRETO);
      expect(crudo).not.toContain('passwordHash');
      expect(crudo).not.toContain('mfaSecret');
      expect(crudo.toLowerCase()).not.toContain('password');
      expect(crudo.toLowerCase()).not.toContain('token');
      // Y el usuario expone EXACTAMENTE los cuatro campos del contrato.
      expect(Object.keys(r.body.usuario).sort()).toEqual(CLAVES_USUARIO);
      expect(r.body.usuario).not.toHaveProperty('passwordHash');
      expect(r.body.usuario).not.toHaveProperty('mfaSecret');
    }
  });

  it('7. un usuario sin membresías → tenants [] y activo null, sin error', async () => {
    const srv = app.getHttpServer();
    await db.user.create({
      data: {
        id: ID_SIN_MEMBRESIAS,
        email: EMAIL_SIN_MEMBRESIAS,
        passwordHash: await bcrypt.hash(PASSWORD_PLAIN, 10),
        nombre: 'Usuario Sin Clínica',
      },
    });
    const login = await request(srv)
      .post('/api/auth/login')
      .send({ email: EMAIL_SIN_MEMBRESIAS, password: PASSWORD_PLAIN })
      .expect(200);
    const H = { Authorization: `Bearer ${login.body.access_token as string}` };

    const r = await request(srv).get('/api/auth/sesion').set(H).expect(200);
    expect(r.body.usuario.id).toBe(ID_SIN_MEMBRESIAS);
    expect(r.body.usuario.nombre).toBe('Usuario Sin Clínica');
    expect(r.body.usuario.cop).toBeNull();
    expect(r.body.tenants).toEqual([]);
    expect(r.body.activo).toBeNull();

    // Sin membresías, declarar una clínica real sigue siendo 403 (no 200 mudo).
    await request(srv)
      .get('/api/auth/sesion')
      .set({ ...H, 'X-Tenant-Id': datos.a.tenantId })
      .expect(403);
  });
});
