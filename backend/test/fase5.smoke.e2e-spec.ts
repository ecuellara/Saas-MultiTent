/**
 * Smoke Fase 5 (RBAC + entitlements) y Fase 6 (plataforma).
 * Criterios: un recepcionista no anula pagos; el plan Consultorio no
 * crea segunda sede; la plataforma suspende/reactiva tenants.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

type Db = {
  permission: { findMany: (a: unknown) => Promise<Array<{ codigo: string }>> };
  plan: {
    findMany: (a: unknown) => Promise<Array<{ id: string }>>;
    create: (a: unknown) => Promise<{ id: string }>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  planFeature: { create: (a: unknown) => Promise<unknown> };
  subscription: {
    create: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformUser: {
    create: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformAuditLog: {
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  user: { deleteMany: (a: unknown) => Promise<unknown> };
};

describe('Smoke Fase 5/6', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let adminH: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;
    await limpiarDosTenants(prisma);
    await db.user.deleteMany({ where: { email: { in: ['recep@test.pe'] } } });
    await db.subscription.deleteMany({ where: { tenantId: { startsWith: 'ta-' } } });
    await db.plan.deleteMany({ where: { codigo: { in: ['consultorio', 'clinica'] } } });
    await db.platformAuditLog.deleteMany({});
    await db.platformUser.deleteMany({ where: { email: 'owner@test.pe' } });
    datos = await seedDosTenants(prisma);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    adminH = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await limpiarDosTenants(prisma);
      await db.user.deleteMany({ where: { email: { in: ['recep@test.pe'] } } });
      await db.subscription.deleteMany({ where: { tenantId: { startsWith: 'ta-' } } });
      await db.plan.deleteMany({ where: { codigo: { in: ['consultorio', 'clinica'] } } });
      await db.platformAuditLog.deleteMany({});
      await db.platformUser.deleteMany({ where: { email: 'owner@test.pe' } });
    }
    if (app) await app.close();
  });

  async function crearPlan(codigo: string, multiSede: boolean, maxSedes: number): Promise<void> {
    const plan = await db.plan.create({
      data: { codigo, nombre: codigo, descripcion: '', precioMensual: 10 },
    });
    for (const f of [
      { clave: 'multi_sede', habilitado: multiSede, limite: null },
      { clave: 'max_sedes', habilitado: true, limite: maxSedes },
      { clave: 'max_usuarios', habilitado: true, limite: 20 },
    ]) {
      await db.planFeature.create({ data: { planId: plan.id, ...f } });
    }
  }

  it('RBAC: recepcionista no anula pagos ni edita pacientes', async () => {
    const srv = app.getHttpServer();
    const rol = await request(srv).post('/api/roles').set(adminH).send({ codigo: 'RECEP', nombre: 'Recepción' }).expect(201);
    await request(srv).patch(`/api/roles/${rol.body.id}/permisos`).set(adminH).send({
      codigos: ['patients.read', 'appointments.write'],
    }).expect(200);
    await request(srv).post('/api/usuarios').set(adminH).send({
      email: 'recep@test.pe', password: 'Recep-Segura-2026!', nombre: 'Recep',
      roleId: rol.body.id, sedeId: datos.a.sedeId,
    }).expect(201);
    const login = await request(srv).post('/api/auth/login')
      .send({ email: 'recep@test.pe', password: 'Recep-Segura-2026!' })
      .expect(200);
    const H = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
    // Lectura propia permitida (lecturas abiertas en esta fase).
    await request(srv).get(`/api/pacientes/${datos.a.pacienteId}`).set(H).expect(200);
    // Escritura sensible denegada con 403 (el backend rechaza, no solo oculta).
    await request(srv).patch(`/api/pagos/${datos.a.pagoId}/anular`).set(H).expect(403);
    await request(srv).patch(`/api/pacientes/${datos.a.pacienteId}`).set(H).send({ telefono: '000' }).expect(403);
  });

  it('Entitlements: Consultorio no crea segunda sede; Clínica sí', async () => {
    const srv = app.getHttpServer();
    await crearPlan('consultorio', false, 1);
    await crearPlan('clinica', true, 3);

    // Alta del owner y suscripción inicial por el flujo real de plataforma
    // (el PUT invalida la caché de entitlements).
    const hash = await bcrypt.hash('Owner-Segura-2026!', 10);
    await db.platformUser.create({
      data: { email: 'owner@test.pe', passwordHash: hash, nombre: 'Owner', rol: 'owner' },
    });
    const plogin = await request(srv).post('/api/platform/auth/login')
      .send({ email: 'owner@test.pe', password: 'Owner-Segura-2026!' })
      .expect(200);
    const PH = { Authorization: `Bearer ${plogin.body.access_token}` };
    await request(srv).put('/api/platform/subscriptions').set(PH).send({
      tenantId: datos.a.tenantId, planCodigo: 'consultorio',
    }).expect(200);
    await request(srv).post('/api/sedes').set(adminH).send({ nombre: 'Sede norte' }).expect(403);

    // Upgrade a Clínica: la segunda sede ya procede.
    await request(srv).put('/api/platform/subscriptions').set(PH).send({
      tenantId: datos.a.tenantId, planCodigo: 'clinica',
    }).expect(200);
    const sede2 = await request(srv).post('/api/sedes').set(adminH).send({ nombre: 'Sede norte' }).expect(201);
    expect(sede2.body.tenantId).toBe(datos.a.tenantId);

    const lista = await request(srv).get('/api/platform/tenants').set(PH).expect(200);
    expect(Array.isArray(lista.body)).toBe(true);
    const met = await request(srv).get(`/api/platform/tenants/${datos.a.tenantId}/metricas`).set(PH).expect(200);
    expect(met.body.pacientes).toBeGreaterThan(0);
  });

  it('Plataforma: suspender bloquea al tenant; reactivar lo restaura', async () => {
    const srv = app.getHttpServer();
    const plogin = await request(srv).post('/api/platform/auth/login')
      .send({ email: 'owner@test.pe', password: 'Owner-Segura-2026!' })
      .expect(200);
    const PH = { Authorization: `Bearer ${plogin.body.access_token}` };
    await request(srv).patch(`/api/platform/tenants/${datos.a.tenantId}`).set(PH).send({ estado: 'SUSPENDED' }).expect(200);
    await request(srv).get(`/api/pacientes/${datos.a.pacienteId}`).set(adminH).expect(403);
    await request(srv).patch(`/api/platform/tenants/${datos.a.tenantId}`).set(PH).send({ estado: 'ACTIVE' }).expect(200);
    await request(srv).get(`/api/pacientes/${datos.a.pacienteId}`).set(adminH).expect(200);
  });

  it('Plataforma: export por tenant sin secretos', async () => {
    const srv = app.getHttpServer();
    const plogin = await request(srv).post('/api/platform/auth/login')
      .send({ email: 'owner@test.pe', password: 'Owner-Segura-2026!' })
      .expect(200);
    const PH = { Authorization: `Bearer ${plogin.body.access_token}` };
    const r = await request(srv).get(`/api/platform/tenants/${datos.a.tenantId}/export`).set(PH).expect(200);
    expect(r.body.tenantId).toBe(datos.a.tenantId);
    const tablas = r.body.tablas as Record<string, unknown[]>;
    expect(tablas.pacientes.map((p) => (p as { id: string }).id)).toContain(datos.a.pacienteId);
    expect(tablas.pacientes.every((p) => (p as { tenantId: string }).tenantId === datos.a.tenantId)).toBe(true);
    for (const u of tablas.usuarios as Array<Record<string, unknown>>) {
      expect(u.passwordHash).toBeUndefined();
      expect(u.mfaSecret).toBeUndefined();
    }
    await request(srv).get(`/api/platform/tenants/no-existe/export`).set(PH).expect(404);
  });
});
