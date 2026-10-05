/**
 * Smoke Fase 8 (facturación): checkout idempotente, webhooks firmados
 * idempotentes, firma inválida rechazada y dunning con corte.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { canonico } from '../src/modules/facturacion/verificadores.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

type Db = {
  plan: {
    create: (a: unknown) => Promise<{ id: string }>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  planFeature: { create: (a: unknown) => Promise<unknown> };
  subscription: {
    findUnique: (a: unknown) => Promise<{ estado: string; periodoFin: Date } | null>;
    update: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformUser: {
    create: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  webhookEvent: {
    deleteMany: (a: unknown) => Promise<unknown>;
  };
};

describe('Smoke Fase 8', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let adminH: Record<string, string>;
  let PH: Record<string, string>;

  beforeAll(async () => {
    process.env.BILLING_HMAC_SECRET = 'secreto-hmac-pruebas-1234567890';
    process.env.BILLING_MP_SECRET = 'secreto-mp-pruebas-1234567890';
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;
    await limpiarDosTenants(prisma);
    await db.subscription.deleteMany({ where: { tenantId: { startsWith: 'ta-' } } });
    await db.webhookEvent.deleteMany({ where: { eventId: { in: ['hmac-evt-1', 'mp-pay-1'] } } });
    await db.plan.deleteMany({ where: { codigo: { in: ['consultorio', 'clinica'] } } });
    await db.platformUser.deleteMany({ where: { email: 'billing-owner@test.pe' } });
    datos = await seedDosTenants(prisma);
    const plan = await db.plan.create({
      data: { codigo: 'clinica', nombre: 'Clínica', descripcion: '', precioMensual: 249 },
    });
    await db.planFeature.create({ data: { planId: plan.id, clave: 'multi_sede', habilitado: true, limite: null } });
    const { hashPassword } = await import('../src/core/auth/passwords.js');
    await db.platformUser.create({
      data: { email: 'billing-owner@test.pe', passwordHash: await hashPassword('Owner-Billing-2026!'), passwordAlgo: 'argon2id', nombre: 'Billing', rol: 'owner' },
    });
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    adminH = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
    const plogin = await request(app.getHttpServer())
      .post('/api/platform/auth/login')
      .send({ email: 'billing-owner@test.pe', password: 'Owner-Billing-2026!' })
      .expect(200);
    PH = { Authorization: `Bearer ${plogin.body.access_token}` };
    // Suscripción base ACTIVE con fin futuro.
    const fin = new Date();
    fin.setDate(fin.getDate() + 30);
    await request(app.getHttpServer()).put('/api/platform/subscriptions').set(PH).send({
      tenantId: datos.a.tenantId, planCodigo: 'clinica', estado: 'ACTIVE',
      periodoInicio: new Date().toISOString(), periodoFin: fin.toISOString(),
    }).expect(200);
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await limpiarDosTenants(prisma);
      await db.subscription.deleteMany({ where: { tenantId: { startsWith: 'ta-' } } });
      await db.webhookEvent.deleteMany({ where: { eventId: { in: ['hmac-evt-1', 'mp-pay-1'] } } });
      await db.plan.deleteMany({ where: { codigo: { in: ['consultorio', 'clinica'] } } });
      await db.platformUser.deleteMany({ where: { email: 'billing-owner@test.pe' } });
    }
    delete process.env.BILLING_HMAC_SECRET;
    delete process.env.BILLING_MP_SECRET;
    if (app) await app.close();
  });

  function firmarHmac(body: object): string {
    const secreto = process.env.BILLING_HMAC_SECRET!;
    return `sha256=${crypto.createHmac('sha256', secreto).update(canonico(body)).digest('hex')}`;
  }

  it('checkout idempotente por mes', async () => {
    const srv = app.getHttpServer();
    const c1 = await request(srv).post('/api/platform/facturacion/checkout').set(PH).send({
      tenantId: datos.a.tenantId, planCodigo: 'clinica',
    }).expect(201);
    const c2 = await request(srv).post('/api/platform/facturacion/checkout').set(PH).send({
      tenantId: datos.a.tenantId, planCodigo: 'clinica',
    }).expect(201);
    expect(c2.body.id).toBe(c1.body.id);
    expect(c2.body.estado).toBe('pendiente');
  });

  it('webhook hmac válido aprueba y el replay no extiende dos veces', async () => {
    const srv = app.getHttpServer();
    const antes = await db.subscription.findUnique({ where: { tenantId: datos.a.tenantId } });
    const cobro = await request(srv).post('/api/platform/facturacion/checkout').set(PH).send({
      tenantId: datos.a.tenantId, planCodigo: 'clinica',
    }).expect(201);
    const body = { event_id: 'evt-1', tipo: 'pago.aprobado', referencia: cobro.body.id };
    const r1 = await request(srv).post('/api/webhooks/hmac')
      .set({ 'x-signature': firmarHmac(body) })
      .send(body)
      .expect(200);
    expect(r1.body.ok).toBe(true);
    const despues = await db.subscription.findUnique({ where: { tenantId: datos.a.tenantId } });
    expect(despues?.estado).toBe('ACTIVE');
    expect(new Date(despues!.periodoFin).getTime()).toBeGreaterThan(new Date(antes!.periodoFin).getTime());
    // Replay del mismo evento: duplicado, sin segunda extensión.
    const r2 = await request(srv).post('/api/webhooks/hmac')
      .set({ 'x-signature': firmarHmac(body) })
      .send(body)
      .expect(200);
    expect(r2.body.duplicado).toBe(true);
    const final = await db.subscription.findUnique({ where: { tenantId: datos.a.tenantId } });
    expect(new Date(final!.periodoFin).getTime()).toBe(new Date(despues!.periodoFin).getTime());
  });

  it('firma inválida, proveedor desconocido y secreto ausente', async () => {
    const srv = app.getHttpServer();
    const body = { event_id: 'evt-x', tipo: 'pago.aprobado', referencia: 'nada' };
    await request(srv).post('/api/webhooks/hmac')
      .set({ 'x-signature': 'sha256=00' })
      .send(body)
      .expect(401);
    await request(srv).post('/api/webhooks/stripe')
      .set({ 'x-signature': 'x' })
      .send(body)
      .expect(404);
    const guardado = process.env.BILLING_HMAC_SECRET;
    const firmaValida = firmarHmac(body);
    delete process.env.BILLING_HMAC_SECRET;
    await request(srv).post('/api/webhooks/hmac')
      .set({ 'x-signature': firmaValida })
      .send(body)
      .expect(503);
    process.env.BILLING_HMAC_SECRET = guardado;
  });

  it('webhook mercadopago válido y manipulado', async () => {
    const srv = app.getHttpServer();
    const cobro = await request(srv).post('/api/platform/facturacion/checkout').set(PH).send({
      tenantId: datos.a.tenantId, planCodigo: 'clinica',
    }).expect(201);
    const secreto = process.env.BILLING_MP_SECRET!;
    const ts = Math.floor(Date.now() / 1000).toString();
    const rid = 'req-123';
    const body = { action: 'payment.approved', data: { id: 'pay-1' }, metadata: { referencia: cobro.body.id } };
    const v1 = crypto.createHmac('sha256', secreto).update(`id:pay-1;request-id:${rid};ts:${ts}`).digest('hex');
    await request(srv).post('/api/webhooks/mercadopago')
      .set({ 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': rid })
      .send(body)
      .expect(200);
    // Manipulado: firma de otro cuerpo.
    await request(srv).post('/api/webhooks/mercadopago')
      .set({ 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': rid })
      .send({ action: 'payment.approved', data: { id: 'pay-OTRO' }, metadata: { referencia: cobro.body.id } })
      .expect(401);
  });

  it('dunning: mora, suspensión y corte del tenant', async () => {
    const srv = app.getHttpServer();
    // Vence ayer → PAST_DUE (sigue operando).
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    await db.subscription.update({ where: { tenantId: datos.a.tenantId }, data: { periodoFin: ayer } });
    const d1 = await request(srv).post('/api/platform/facturacion/dunning').set(PH).expect(200);
    expect(d1.body.morosos).toBe(1);
    await request(srv).get(`/api/pacientes/${datos.a.pacienteId}`).set(adminH).expect(200);
    // Vence hace 8 días → SUSPENDED (bloquea).
    const hace8 = new Date();
    hace8.setDate(hace8.getDate() - 8);
    await db.subscription.update({ where: { tenantId: datos.a.tenantId }, data: { periodoFin: hace8 } });
    const d2 = await request(srv).post('/api/platform/facturacion/dunning').set(PH).expect(200);
    expect(d2.body.suspendidos).toBe(1);
    await request(srv).get(`/api/pacientes/${datos.a.pacienteId}`).set(adminH).expect(403);
    // Paga de nuevo → se restaura.
    const futuro = new Date();
    futuro.setDate(futuro.getDate() + 30);
    await request(srv).put('/api/platform/subscriptions').set(PH).send({
      tenantId: datos.a.tenantId, planCodigo: 'clinica', estado: 'ACTIVE',
      periodoInicio: new Date().toISOString(), periodoFin: futuro.toISOString(),
    }).expect(200);
    await request(srv).get(`/api/pacientes/${datos.a.pacienteId}`).set(adminH).expect(200);
  });
});
