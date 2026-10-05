/**
 * Smoke Fase 7 (seguridad): refresh rotativo con detección de reuso, logout,
 * cambio de clave que invalida tokens, upgrade Argon2id y MFA de plataforma.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { generarCodigoTotp } from '../src/core/auth/totp.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

type Db = {
  user: {
    findUnique: (a: unknown) => Promise<{ passwordAlgo: string; passwordHash: string } | null>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformUser: {
    create: (a: unknown) => Promise<{ id: string }>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
};

function refreshDe(r: request.Response): string {
  const cookies = ((r.headers['set-cookie'] ?? []) as unknown) as string[];
  const c = cookies.find((x) => x.startsWith('refresh_token='));
  expect(c, 'sin cookie refresh_token').toBeTruthy();
  return c!.split(';')[0]!;
}

describe('Smoke Fase 7', () => {
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
    await db.user.deleteMany({ where: { email: { in: ['clave@test.pe'] } } });
    await db.platformUser.deleteMany({ where: { email: 'mfa-owner@test.pe' } });
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
      await db.user.deleteMany({ where: { email: { in: ['clave@test.pe'] } } });
      await db.platformUser.deleteMany({ where: { email: 'mfa-owner@test.pe' } });
    }
    if (app) await app.close();
  });

  it('login migra el hash a Argon2id', async () => {
    const u = await db.user.findUnique({ where: { email: datos.a.userEmail } });
    expect(u?.passwordAlgo).toBe('argon2id');
    expect(u?.passwordHash.startsWith('$argon2id$')).toBe(true);
  });

  it('refresh rota y el reuso revoca la cadena', async () => {
    const srv = app.getHttpServer();
    const l1 = await request(srv).post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    const r1 = refreshDe(l1);
    const r2res = await request(srv).post('/api/auth/refresh').set('Cookie', r1).expect(200);
    expect(r2res.body.access_token).toBeTruthy();
    const r2 = refreshDe(r2res);
    // Reuso del refresh ya rotado: 401 y revoca toda la cadena.
    await request(srv).post('/api/auth/refresh').set('Cookie', r1).expect(401);
    await request(srv).post('/api/auth/refresh').set('Cookie', r2).expect(401);
  });

  it('logout invalida el refresh', async () => {
    const srv = app.getHttpServer();
    const l = await request(srv).post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    const c = refreshDe(l);
    await request(srv).post('/api/auth/logout').set('Cookie', c).expect(200);
    await request(srv).post('/api/auth/refresh').set('Cookie', c).expect(401);
  });

  it('cambiar la clave invalida access y refresh previos', async () => {
    const srv = app.getHttpServer();
    await request(srv).post('/api/usuarios').set(adminH).send({
      email: 'clave@test.pe', password: 'Clave-Inicial-2026!', nombre: 'Clave',
      roleId: datos.a.roleId, sedeId: datos.a.sedeId,
    }).expect(201);
    const l = await request(srv).post('/api/auth/login')
      .send({ email: 'clave@test.pe', password: 'Clave-Inicial-2026!' })
      .expect(200);
    const viejoAccess = l.body.access_token as string;
    const viejoRefresh = refreshDe(l);
    const H = { Authorization: `Bearer ${viejoAccess}`, 'X-Tenant-Id': datos.a.tenantId };
    await request(srv).post('/api/auth/cambiar-clave').set(H).send({
      actual: 'Clave-Inicial-2026!', nueva: 'Clave-Nueva-2026!!',
    }).expect(200);
    // Access previo: 401. Refresh previo: 401.
    await request(srv).get(`/api/pacientes/${datos.a.pacienteId}`).set(H).expect(401);
    await request(srv).post('/api/auth/refresh').set('Cookie', viejoRefresh).expect(401);
    // Nueva clave funciona.
    await request(srv).post('/api/auth/login')
      .send({ email: 'clave@test.pe', password: 'Clave-Nueva-2026!!' })
      .expect(200);
  });

  it('MFA de plataforma: setup, login con TOTP y refresh', async () => {
    const srv = app.getHttpServer();
    const hash = await bcrypt.hash('Owner-Mfa-2026!!', 10);
    await db.platformUser.create({
      data: { email: 'mfa-owner@test.pe', passwordHash: hash, nombre: 'Owner MFA', rol: 'owner' },
    });
    const l1 = await request(srv).post('/api/platform/auth/login')
      .send({ email: 'mfa-owner@test.pe', password: 'Owner-Mfa-2026!!' })
      .expect(200);
    const pleno = l1.body.access_token as string;
    const PH = { Authorization: `Bearer ${pleno}` };
    const setup = await request(srv).post('/api/platform/auth/mfa/setup').set(PH).expect(200);
    expect(setup.body.secret).toBeTruthy();
    expect(setup.body.otpauth_url).toContain('otpauth://');
    await request(srv).post('/api/platform/auth/mfa/confirm').set(PH)
      .send({ code: await generarCodigoTotp(setup.body.secret as string) })
      .expect(200);
    // Desde ahora el login con clave devuelve temporal MFA.
    const l2 = await request(srv).post('/api/platform/auth/login')
      .send({ email: 'mfa-owner@test.pe', password: 'Owner-Mfa-2026!!' })
      .expect(200);
    expect(l2.body.mfa_required).toBe(true);
    // El temporal no sirve para el panel.
    await request(srv).get('/api/platform/tenants')
      .set({ Authorization: `Bearer ${l2.body.temp_token}` })
      .expect(401);
    // Código erróneo: 401.
    await request(srv).post('/api/platform/auth/mfa/verify')
      .send({ temp_token: l2.body.temp_token, code: '000000' })
      .expect(401);
    const v = await request(srv).post('/api/platform/auth/mfa/verify')
      .send({ temp_token: l2.body.temp_token, code: await generarCodigoTotp(setup.body.secret as string) })
      .expect(200);
    await request(srv).get('/api/platform/tenants')
      .set({ Authorization: `Bearer ${v.body.access_token}` })
      .expect(200);
    // Refresh de plataforma rota.
    const rc = refreshDe(v);
    const rr = await request(srv).post('/api/platform/auth/refresh').set('Cookie', rc).expect(200);
    expect(rr.body.access_token).toBeTruthy();
  });
});
