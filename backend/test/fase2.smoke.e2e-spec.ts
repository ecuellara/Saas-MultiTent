/**
 * Smoke temporal de Fase 2/3 (NO es contrato): verifica los flujos nuevos
 * contra la BD de pruebas. Se ejecuta y luego se elimina.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';
import { fechaFutura } from './helpers/fechas.js';

describe('Smoke Fase 2/3', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let token: string;
  let H: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    await limpiarDosTenants(prisma);
    // El usuario creado por este smoke tiene id uuid (no lo cubre el fixture).
    await (prisma as unknown as { user: { deleteMany: (a: unknown) => Promise<unknown> } }).user.deleteMany({
      where: { email: 'nuevo@test.pe' },
    });
    datos = await seedDosTenants(prisma);
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    token = login.body.access_token;
    H = { Authorization: `Bearer ${token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await limpiarDosTenants(prisma);
      await (prisma as unknown as { user: { deleteMany: (a: unknown) => Promise<unknown> } }).user.deleteMany({
        where: { email: 'nuevo@test.pe' },
      });
    }
    if (app) await app.close();
  });

  it('health público', async () => {
    const r = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(r.body.status).toBe('ok');
  });

  it('citas: solapa 400, libre 201', async () => {
    // La cita de referencia se crea aquí (antes se usaba la del fixture, con fecha
    // fija de marzo de 2026, que ya es pasado: agendar en el pasado se rechaza).
    const dia = fechaFutura(30);
    await request(app.getHttpServer()).post('/api/citas').set(H).send({
      pacienteId: datos.a.pacienteId, fecha: dia, horaInicio: '09:00', horaFin: '09:30',
    }).expect(201);
    await request(app.getHttpServer()).post('/api/citas').set(H).send({
      pacienteId: datos.a.pacienteId, fecha: dia, horaInicio: '09:15', horaFin: '09:45',
    }).expect(400);
    await request(app.getHttpServer()).post('/api/citas').set(H).send({
      pacienteId: datos.a.pacienteId, fecha: dia, horaInicio: '10:00', horaFin: '10:30',
    }).expect(201);
  });

  it('pagos: tope, abono y anulación condicional', async () => {
    const pago = await request(app.getHttpServer()).post('/api/pagos').set(H).send({
      concepto: 'Test', tipo: 'ingreso', montoTotal: 100, montoPagado: 60,
    }).expect(201);
    expect(String(pago.body.codigoRecibo)).toMatch(/^REC-2026-/);
    await request(app.getHttpServer()).post(`/api/pagos/${pago.body.id}/abonos`).set(H).send({ monto: 50 }).expect(400);
    const abono = await request(app.getHttpServer()).post(`/api/pagos/${pago.body.id}/abonos`).set(H).send({ monto: 40 }).expect(201);
    expect(abono.body.estado).toBe('pagado');
    await request(app.getHttpServer()).patch(`/api/pagos/${pago.body.id}/anular`).set(H).expect(400);
    const p2 = await request(app.getHttpServer()).post('/api/pagos').set(H).send({ concepto: 'P', tipo: 'ingreso', montoTotal: 50 }).expect(201);
    const an = await request(app.getHttpServer()).patch(`/api/pagos/${p2.body.id}/anular`).set(H).expect(200);
    expect(an.body.estado).toBe('anulado');
  });

  it('compras atómicas + stock', async () => {
    await request(app.getHttpServer()).post('/api/compras').set(H).send({
      proveedorId: datos.a.proveedorId, fecha: '2026-03-15',
      detalles: [{ insumoId: datos.a.insumoId, cantidad: 5, precioUnit: 25 }],
    }).expect(201);
    const ins = await request(app.getHttpServer()).get(`/api/insumos/${datos.a.insumoId}`).set(H).expect(200);
    expect(ins.body.stockActual).toBe(15);
  });

  it('odontograma versionado + bloqueo por firma', async () => {
    const od2 = await request(app.getHttpServer()).post('/api/odontogramas').set(H).send({
      pacienteId: datos.a.pacienteId, fecha: '2026-03-11', piezas: { '11': { estado: 'sano' } },
    }).expect(201);
    expect(od2.body.version).toBe(2);
    await request(app.getHttpServer()).patch(`/api/odontogramas/${datos.a.odontogramaId}/firmar`).set(H).send({ firmadoPor: 'dr-a' }).expect(200);
    await request(app.getHttpServer()).post(`/api/odontogramas/${datos.a.odontogramaId}/hallazgos`).set(H).send({
      pieza: '16', hallazgoCodigo: 'CARIES', estadoClinico: 'patologico', color: 'rojo',
    }).expect(400);
  });

  it('consentimientos: transiciones y snapshot', async () => {
    const db = prisma as unknown as {
      consentimientoPlantilla: { findFirst: (a: unknown) => Promise<{ id: string }> };
    };
    const pl = await db.consentimientoPlantilla.findFirst({ where: { tenantId: datos.a.tenantId } });
    const cons = await request(app.getHttpServer()).post('/api/consentimientos').set(H).send({
      pacienteId: datos.a.pacienteId, plantillaId: pl.id, datosSnapshot: { ok: true },
    }).expect(201);
    expect(typeof cons.body.cuerpoSnapshot).toBe('string');
    await request(app.getHttpServer()).patch(`/api/consentimientos/${cons.body.id}/estado`).set(H).send({ estado: 'revocado' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/consentimientos/${cons.body.id}/estado`).set(H).send({ estado: 'firmado' }).expect(200);
    const rev = await request(app.getHttpServer()).patch(`/api/consentimientos/${cons.body.id}/estado`).set(H).send({ estado: 'revocado' }).expect(200);
    expect(rev.body.revocadoEn).toBeTruthy();
  });

  it('documentos: MIME y clave de tenant', async () => {
    await request(app.getHttpServer()).post(`/api/pacientes/${datos.a.pacienteId}/documentos`).set(H).send({
      nombreArchivo: 'x.exe', tipo: 'OTRO', mimeType: 'application/x-msdownload',
    }).expect(400);
    await request(app.getHttpServer()).post(`/api/pacientes/${datos.a.pacienteId}/documentos`).set(H).send({
      nombreArchivo: 'r.png', tipo: 'RX', mimeType: 'image/png', storageKey: `tenants/${datos.b.tenantId}/x.png`,
    }).expect(400);
    const doc = await request(app.getHttpServer()).post(`/api/pacientes/${datos.a.pacienteId}/documentos`).set(H).send({
      nombreArchivo: 'r.png', tipo: 'RX', mimeType: 'image/png', tamanioKb: 100,
    }).expect(201);
    expect(String(doc.body.storageKey).startsWith(`tenants/${datos.a.tenantId}/`)).toBe(true);
  });

  it('usuarios: política de contraseña', async () => {
    await request(app.getHttpServer()).post('/api/usuarios').set(H).send({
      email: 'nuevo@test.pe', password: 'corta', nombre: 'X', roleId: datos.a.roleId, sedeId: datos.a.sedeId,
    }).expect(400);
    await request(app.getHttpServer()).post('/api/usuarios').set(H).send({
      email: 'nuevo@test.pe', password: 'Clave-Segura-2026!', nombre: 'Nuevo', roleId: datos.a.roleId, sedeId: datos.a.sedeId,
    }).expect(201);
  });
});
