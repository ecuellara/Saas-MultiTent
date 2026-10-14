import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { aCentimos, desdeCentimos } from '../src/modules/pagos/izipay.service.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { limpiarDosTenants, seedDosTenants, PASSWORD_PLAIN, type DosTenants } from './helpers/tenants-fixture.js';

describe('Izipay pagos únicos REST V4 (stub HTTP local)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let H: Record<string, string>;
  let stub: Server;
  let recibido: Record<string, unknown>;
  let auth: string | undefined;
  let ruta: string | undefined;
  const variables = ['IZIPAY_BASE_URL', 'IZIPAY_SHOP_ID', 'IZIPAY_CLAVE', 'IZIPAY_CLAVE_HMAC', 'IZIPAY_PUBLIC_KEY'];
  const previas = Object.fromEntries(variables.map((k) => [k, process.env[k]]));
  const http = () => request(app.getHttpServer());
  const token = () => http().post(`/api/pagos/${datos.a.pagoId}/izipay/formtoken`).set(H);
  async function aviso(opciones: { orderId?: string; uuid?: string; amount?: number; currency?: string; status?: string; key?: string } = {}) {
    if (!opciones.orderId) await token().expect(201);
    const raw = JSON.stringify({ shopId: 'shop-test', orderStatus: opciones.status ?? 'PAID',
      orderDetails: { orderId: opciones.orderId ?? recibido.orderId },
      transactions: [{ uuid: opciones.uuid ?? randomUUID(), status: opciones.status ?? 'PAID', amount: opciones.amount ?? 12050, currency: opciones.currency ?? 'PEN' }],
    }, null, 2); // Espacios y saltos: NO es el JSON canónico.
    const key = opciones.key ?? 'password';
    return { 'kr-answer': raw, 'kr-hash-key': key, 'kr-hash-algorithm': 'sha256_hmac',
      'kr-hash': createHmac('sha256', key === 'password' ? 'rest-test' : 'hmac-test').update(raw).digest('hex') };
  }
  beforeAll(async () => {
    stub = createServer((req, res) => {
      auth = req.headers.authorization;
      ruta = req.url;
      let body = '';
      req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', () => {
        recibido = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'SUCCESS', answer: { formToken: 'stub-form-token' } }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const port = (stub.address() as { port: number }).port;
    Object.assign(process.env, { IZIPAY_BASE_URL: `http://127.0.0.1:${port}`, IZIPAY_SHOP_ID: 'shop-test',
      IZIPAY_CLAVE: 'rest-test', IZIPAY_CLAVE_HMAC: 'hmac-test', IZIPAY_PUBLIC_KEY: 'public-test' });
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);
    const login = await http().post('/api/auth/login').send({ email: datos.a.userEmail, password: PASSWORD_PLAIN }).expect(200);
    H = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  });
  beforeEach(async () => {
    await prisma.auditoria.deleteMany({ where: { accion: 'IZIPAY_ABONO' } });
    await prisma.eventoIzipay.deleteMany({});
    await prisma.intentoIzipay.deleteMany({});
    await prisma.pago.update({ where: { id: datos.a.pagoId }, data: { montoTotal: '180.50', montoPagado: '60.00', saldo: '120.50', estado: 'parcial' } });
  });
  afterAll(async () => {
    if (prisma) { await prisma.eventoIzipay.deleteMany({}); await limpiarDosTenants(prisma); }
    if (app) await app.close();
    if (stub) await new Promise<void>((resolve, reject) => stub.close((e) => e ? reject(e) : resolve()));
    for (const k of variables) { if (previas[k] === undefined) delete process.env[k]; else process.env[k] = previas[k]; }
  });

  it('ignora importe, estado y orderId del cliente; usa saldo Decimal, Basic auth y metadata propios', async () => {
    const r = await token().send({ amount: 1, monto: 1, orderId: 'atacante', estado: 'pagado' }).expect(201);
    expect(r.body).toEqual({ formToken: 'stub-form-token', publicKey: 'public-test' });
    expect(recibido.amount).toBe(12050);
    expect(recibido.orderId).not.toBe('atacante');
    expect(recibido.currency).toBe('PEN');
    expect(recibido.formAction).toBe('PAY');
    expect(auth).toBe(`Basic ${Buffer.from('shop-test:rest-test').toString('base64')}`);
    expect(ruta).toBe('/api-payment/V4/Charge/CreatePayment');
    expect(recibido.metadata).toMatchObject({ pagoId: datos.a.pagoId, tenantId: datos.a.tenantId });
    expect(await prisma.intentoIzipay.findUnique({ where: { orderId: String(recibido.orderId) } })).toMatchObject({ importeCentimos: 12050n });
    expect(desdeCentimos(aCentimos('120.50')).toFixed(2)).toBe('120.50');
    expect(aCentimos('0.29')).toBe(29);
    expect(() => aCentimos('1.001')).toThrow();
  });
  it('IPN público firmado raw paga el saldo e ignora cabecera tenant falsa', async () => {
    const body = await aviso();
    await http().post('/api/webhooks/izipay').set('X-Tenant-Id', datos.b.tenantId).type('form').send(body).expect(200);
    const pago = await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } });
    expect(pago.estado).toBe('pagado'); expect(pago.montoPagado.toFixed(2)).toBe('180.50'); expect(pago.saldo.toFixed(2)).toBe('0.00');
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: datos.b.pagoId } })).montoPagado.toFixed(2)).toBe('60.00');
    expect(await prisma.eventoIzipay.findFirst()).toMatchObject({ rawAnswer: body['kr-answer'], firmaValida: true, estado: 'procesado' });
  });
  it('valida el retorno HMAC del navegador sin abonar ni crear un evento IPN', async () => {
    const body = await aviso({ key: 'sha256_hmac' });
    const antes = await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } });
    const r = await http().post(`/api/pagos/${datos.a.pagoId}/izipay/validar`).set(H).send(body).expect(201);
    expect(r.body).toEqual({ valido: true, orderStatus: 'PAID' });
    expect(await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } })).toEqual(antes);
    expect(await prisma.eventoIzipay.count()).toBe(0);
    expect(await prisma.auditoria.count({ where: { accion: 'IZIPAY_ABONO' } })).toBe(0);
    // La firma del retorno no se acepta como una notificación servidor-a-servidor.
    await http().post('/api/webhooks/izipay').send(body).expect(401);
    const ipn = { ...body, 'kr-hash-key': 'password',
      'kr-hash': createHmac('sha256', 'rest-test').update(body['kr-answer']).digest('hex') };
    await http().post('/api/webhooks/izipay').send(ipn).expect(200);
    // El IPN puede adelantarse al retorno; este sigue validando contra el intento.
    await http().post(`/api/pagos/${datos.a.pagoId}/izipay/validar`).set(H).send(body).expect(201);
    expect(await prisma.eventoIzipay.count()).toBe(1);
  });
  it('retorno con firma inválida o clave de IPN se rechaza sin abonar', async () => {
    const body = await aviso({ key: 'sha256_hmac' });
    await http().post(`/api/pagos/${datos.a.pagoId}/izipay/validar`).set(H)
      .send({ ...body, 'kr-hash': '0'.repeat(64) }).expect(401);
    const ipn = { ...body, 'kr-hash-key': 'password',
      'kr-hash': createHmac('sha256', 'rest-test').update(body['kr-answer']).digest('hex') };
    await http().post(`/api/pagos/${datos.a.pagoId}/izipay/validar`).set(H).send(ipn).expect(401);
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } })).montoPagado.toFixed(2)).toBe('60.00');
    expect(await prisma.eventoIzipay.count()).toBe(0);
  });
  it('retorno firmado debe conciliar importe, moneda, pago y clínica', async () => {
    for (const opciones of [{ amount: 100 }, { currency: 'USD' }, { orderId: 'desconocido' }]) {
      const body = await aviso({ ...opciones, key: 'sha256_hmac' });
      await http().post(`/api/pagos/${datos.a.pagoId}/izipay/validar`).set(H).send(body).expect(400);
    }
    const orderId = randomUUID();
    await prisma.intentoIzipay.create({ data: { orderId, tenantId: datos.b.tenantId,
      pagoId: datos.b.pagoId, usuarioId: datos.b.userId, importeCentimos: 12050n, metadata: {} } });
    const ajeno = await aviso({ orderId, key: 'sha256_hmac' });
    await http().post(`/api/pagos/${datos.a.pagoId}/izipay/validar`).set(H).send(ajeno).expect(400);
    await http().post(`/api/pagos/${datos.b.pagoId}/izipay/validar`).set(H).send(ajeno).expect(404);
    expect(await prisma.eventoIzipay.count()).toBe(0);
  });
  it('firma inválida devuelve 401 sin cambiar pago, eventos ni auditoría', async () => {
    const body = await aviso();
    await new Promise((resolve) => setTimeout(resolve, 100)); // Auditoría asíncrona del formToken.
    const antes = await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } });
    const auditorias = await prisma.auditoria.count();
    await http().post('/api/webhooks/izipay').send({ ...body, 'kr-hash': '0'.repeat(64) }).expect(401);
    await http().post('/api/webhooks/izipay/').send({ ...body, 'kr-hash': '0'.repeat(64) }).expect(401);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } })).toEqual(antes);
    expect(await prisma.eventoIzipay.count()).toBe(0);
    expect(await prisma.auditoria.count()).toBe(auditorias);
    await http().post('/api/webhooks/izipay').send({ ...body, 'kr-answer': JSON.stringify(JSON.parse(body['kr-answer'])) }).expect(401);
  });
  it('reintentos secuenciales y simultáneos cobran UNA vez', async () => {
    const body = await aviso();
    const enviar = () => http().post('/api/webhooks/izipay').send(body);
    const respuestas = await Promise.all([enviar(), enviar(), enviar()]);
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200]);
    await enviar().expect(200);
    const p = await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } });
    expect(p.montoPagado.toFixed(2)).toBe('180.50');
    expect(await prisma.eventoIzipay.count()).toBe(1);
    expect(await prisma.auditoria.count({ where: { accion: 'IZIPAY_ABONO', registroId: p.id } })).toBe(1);
  });
  it('orden desconocida se audita y no cobra a nadie', async () => {
    const body = await aviso({ orderId: 'desconocido' });
    await http().post('/api/webhooks/izipay').send(body).expect(200);
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } })).montoPagado.toFixed(2)).toBe('60.00');
    expect(await prisma.eventoIzipay.findFirst()).toMatchObject({ estado: 'orden_desconocida', tenantId: null });
  });
  it('importe o moneda diferentes y rechazo no generan abono', async () => {
    for (const opciones of [{ amount: 100 }, { currency: 'USD' }, { status: 'UNPAID' }]) {
      const body = await aviso(opciones);
      await http().post('/api/webhooks/izipay').send(body).expect(200);
    }
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } })).montoPagado.toFixed(2)).toBe('60.00');
  });
  it('IPN tardío respeta el tope, revierte la clave y permite reintentar', async () => {
    const body = await aviso();
    await prisma.pago.update({ where: { id: datos.a.pagoId }, data: { montoPagado: '100.00', saldo: '80.50' } });
    await http().post('/api/webhooks/izipay').send(body).expect(400);
    expect(await prisma.eventoIzipay.count()).toBe(0);
    expect((await prisma.pago.findUniqueOrThrow({ where: { id: datos.a.pagoId } })).montoPagado.toFixed(2)).toBe('100.00');
    await prisma.pago.update({ where: { id: datos.a.pagoId }, data: { montoPagado: '60.00', saldo: '120.50' } });
    await http().post('/api/webhooks/izipay').send(body).expect(200);
    expect(await prisma.eventoIzipay.count()).toBe(1);
  });
  it('rechaza algoritmo y selector de clave no reconocidos', async () => {
    const body = await aviso();
    await http().post('/api/webhooks/izipay').send({ ...body, 'kr-hash-key': 'otro' }).expect(401);
    await http().post('/api/webhooks/izipay').send({ ...body, 'kr-hash-algorithm': 'sha1' }).expect(401);
  });
  it('formToken ajeno devuelve 404', async () => {
    await http().post(`/api/pagos/${datos.b.pagoId}/izipay/formtoken`).set(H).expect(404);
  });
  it('sin payments.write devuelve 403', async () => {
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: datos.a.roleId, permissionId: 'perm-payments.write' } } });
    try {
      await token().expect(403);
      await http().post(`/api/pagos/${datos.a.pagoId}/izipay/validar`).set(H).send({}).expect(403);
    }
    finally { await prisma.rolePermission.create({ data: { roleId: datos.a.roleId, permissionId: 'perm-payments.write' } }); }
  });
  it('sin credenciales falla sin llamar al proveedor', async () => {
    delete process.env.IZIPAY_CLAVE;
    try {
      const respuesta = await token().expect(503);
      expect(respuesta.body.message).toContain('IZIPAY_CLAVE');
      expect(respuesta.body.message).not.toContain('rest-test');
      expect(respuesta.body.message).not.toContain('hmac-test');
    } finally { process.env.IZIPAY_CLAVE = 'rest-test'; }
  });
  it('pagos saldados o anulados devuelven 400', async () => {
    for (const estado of ['pagado', 'anulado'] as const) {
      await prisma.pago.update({ where: { id: datos.a.pagoId }, data: { estado } });
      await token().expect(400);
    }
  });
});
