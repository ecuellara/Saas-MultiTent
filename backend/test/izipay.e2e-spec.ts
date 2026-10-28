import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { aCentimos, desdeCentimos } from '../src/core/pasarela/pasarela.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { limpiarDosTenants, seedDosTenants, PASSWORD_PLAIN, type DosTenants } from './helpers/tenants-fixture.js';

describe('Izipay suscripciones REST V4 (stub HTTP local)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let H: Record<string, string>;
  let HB: Record<string, string>;
  let stub: Server;
  let recibido: Record<string, unknown>;
  let auth: string | undefined;
  let ruta: string | undefined;
  let respuestaStub: { httpStatus: number; body: unknown };
  const variables = ['IZIPAY_BASE_URL', 'IZIPAY_SHOP_ID', 'IZIPAY_CLAVE', 'IZIPAY_CLAVE_HMAC', 'IZIPAY_PUBLIC_KEY'];
  const previas = Object.fromEntries(variables.map((k) => [k, process.env[k]]));
  const http = () => request(app.getHttpServer());
  const token = () => http().post('/api/facturacion/mi-plan/formtoken').set(H);
  // Precio del plan (249) MÁS la comisión de Izipay (11,39): 260,39.
  const PLAN_TOTAL = 26039;
  async function aviso(opciones: { orderId?: string; uuid?: string; amount?: number; currency?: string; status?: string; key?: string } = {}) {
    if (!opciones.orderId) await token().expect(201);
    const raw = JSON.stringify({ shopId: 'shop-test', orderStatus: opciones.status ?? 'PAID',
      orderDetails: { orderId: opciones.orderId ?? recibido.orderId },
      transactions: [{ uuid: opciones.uuid ?? randomUUID(), status: opciones.status ?? 'PAID', amount: opciones.amount ?? PLAN_TOTAL, currency: opciones.currency ?? 'PEN' }],
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
        res.writeHead(respuestaStub.httpStatus, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(respuestaStub.body));
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
    await prisma.plan.upsert({ where: { codigo: 'clinica' },
      update: { precioMensual: 249 },
      create: { codigo: 'clinica', nombre: 'Clínica', descripcion: '', precioMensual: 249 } });
    const plan = await prisma.plan.findUniqueOrThrow({ where: { codigo: 'clinica' } });
    const inicio = new Date();
    const fin = new Date();
    fin.setDate(fin.getDate() + 30);
    await prisma.subscription.upsert({ where: { tenantId: datos.a.tenantId },
      update: { estado: 'ACTIVE', periodoInicio: inicio, periodoFin: fin, planId: plan.id },
      create: { tenantId: datos.a.tenantId, planId: plan.id, estado: 'ACTIVE', periodoInicio: inicio, periodoFin: fin } });
    const login = await http().post('/api/auth/login').send({ email: datos.a.userEmail, password: PASSWORD_PLAIN }).expect(200);
    H = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
    const loginB = await http().post('/api/auth/login').send({ email: datos.b.userEmail, password: PASSWORD_PLAIN }).expect(200);
    HB = { Authorization: `Bearer ${loginB.body.access_token}`, 'X-Tenant-Id': datos.b.tenantId };
  });
  beforeEach(async () => {
    respuestaStub = { httpStatus: 200, body: { status: 'SUCCESS', answer: { formToken: 'stub-form-token' } } };
    await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: 'izipay:' } } });
    await prisma.eventoIzipay.deleteMany({});
    await prisma.intentoIzipay.deleteMany({});
    await prisma.cobroSuscripcion.deleteMany({ where: { tenantId: datos.a.tenantId } });
  });
  afterAll(async () => {
    if (prisma) {
      await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: 'izipay:' } } });
      await prisma.eventoIzipay.deleteMany({});
      await limpiarDosTenants(prisma);
      await prisma.plan.deleteMany({ where: { codigo: 'clinica' } });
    }
    if (app) await app.close();
    if (stub) await new Promise<void>((resolve, reject) => stub.close((e) => e ? reject(e) : resolve()));
    for (const k of variables) { if (previas[k] === undefined) delete process.env[k]; else process.env[k] = previas[k]; }
  });

  it('formtoken del plan: importe del servidor con comisión, inyección del cliente ignorada, céntimos exactos', async () => {
    const r = await token().send({ amount: 1, monto: 1, orderId: 'atacante', estado: 'pagado' }).expect(201);
    expect(r.body.formToken).toBe('stub-form-token');
    expect(r.body.publicKey).toBe('public-test');
    expect(typeof r.body.cobroId).toBe('string');
    // Precio 249 + comisión 11,39 → 260,39.
    expect(r.body.importe).toEqual({ precio: '249.00', comision: '11.39', total: '260.39', moneda: 'PEN' });
    expect(recibido.amount).toBe(PLAN_TOTAL);
    expect(recibido.orderId).not.toBe('atacante');
    expect(recibido.currency).toBe('PEN');
    expect(recibido).not.toHaveProperty('formAction');
    expect(auth).toBe(`Basic ${Buffer.from('shop-test:rest-test').toString('base64')}`);
    expect(ruta).toBe('/api-payment/V4/Charge/CreatePayment');
    expect(recibido.metadata).toMatchObject({ cobroSuscripcionId: r.body.cobroId, tenantId: datos.a.tenantId });
    expect(recibido.metadata).not.toHaveProperty('pagoId');
    const intento = await prisma.intentoIzipay.findUniqueOrThrow({ where: { orderId: String(recibido.orderId) } });
    expect(intento).toMatchObject({ importeCentimos: 26039n, moneda: 'PEN', cobroSuscripcionId: r.body.cobroId });
    // Garantía estructural: el intento NO puede referenciar un Pago.
    expect('pagoId' in intento).toBe(false);
    expect(desdeCentimos(aCentimos('249.00')).toFixed(2)).toBe('249.00');
    expect(aCentimos('0.29')).toBe(29);
    expect(() => aCentimos('1.001')).toThrow();
  });
  it('sin cobro pendiente genera el del periodo con checkout idempotente y reutiliza el pendiente', async () => {
    const r1 = await token().expect(201);
    const cobro = await prisma.cobroSuscripcion.findUniqueOrThrow({ where: { id: r1.body.cobroId } });
    expect(cobro.estado).toBe('pendiente');
    expect(cobro.proveedor).toBe('izipay');
    expect(cobro.monto.toFixed(2)).toBe('249.00');
    expect(cobro.claveIdempotencia.startsWith(`chk-${datos.a.tenantId}-clinica-`)).toBe(true);
    const r2 = await token().expect(201);
    expect(r2.body.cobroId).toBe(r1.body.cobroId);
    expect(r2.body.formToken).toBe('stub-form-token');
    // Intentos distintos (orderId distintos) sobre el MISMO cobro.
    expect(await prisma.intentoIzipay.count({ where: { cobroSuscripcionId: r1.body.cobroId } })).toBe(2);
  });
  it('un ERROR de Izipay dentro de HTTP 200 devuelve un diagnóstico seguro sin token ni claves', async () => {
    respuestaStub = { httpStatus: 200, body: { status: 'ERROR', answer: { errorCode: 'INT_875',
      errorMessage: 'invalid formAction rest-test', detailedErrorMessage: 'hmac-test', formToken: 'token-que-no-debe-salir' } } };
    const r = await token().expect(502);
    expect(r.body.message).toContain('INT_875');
    expect(JSON.stringify(r.body)).not.toMatch(/rest-test|hmac-test|token-que-no-debe-salir/);
    expect(await prisma.cobroSuscripcion.count({ where: { tenantId: datos.a.tenantId } })).toBe(1);
  });
  it('un rechazo de Basic auth devuelve un diagnóstico de autenticación', async () => {
    respuestaStub = { httpStatus: 401, body: { error: 'rest-test' } };
    const r = await token().expect(502);
    expect(r.body.message).toContain('autenticación REST');
    expect(r.body.message).not.toContain('rest-test');
  });
  it('IPN con firma válida marca el cobro pagado, extiende el periodo e ignora cabecera tenant falsa', async () => {
    const antes = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: datos.a.tenantId } });
    const body = await aviso();
    await http().post('/api/webhooks/izipay').set('X-Tenant-Id', datos.b.tenantId).type('form').send(body).expect(200);
    const cobro = await prisma.cobroSuscripcion.findFirstOrThrow({ where: { tenantId: datos.a.tenantId } });
    expect(cobro.estado).toBe('pagado');
    const despues = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: datos.a.tenantId } });
    expect(despues.estado).toBe('ACTIVE');
    expect(despues.periodoFin.getTime()).toBeGreaterThan(antes.periodoFin.getTime());
    // La otra clínica no recibe nada: el tenant sale del aviso, no de la cabecera.
    expect(await prisma.cobroSuscripcion.count({ where: { tenantId: datos.b.tenantId } })).toBe(0);
    expect(await prisma.eventoIzipay.findFirst()).toMatchObject({
      rawAnswer: body['kr-answer'], firmaValida: true, estado: 'procesado',
      cobroSuscripcionId: cobro.id, tenantId: datos.a.tenantId,
    });
    expect(await prisma.auditoria.count({ where: { accion: 'IZIPAY_ABONO' } })).toBe(0);
  });
  it('valida el retorno HMAC del navegador sin conciliar ni crear eventos', async () => {
    const body = await aviso({ key: 'sha256_hmac' });
    const cobroAntes = await prisma.cobroSuscripcion.findFirstOrThrow({ where: { tenantId: datos.a.tenantId } });
    const r = await http().post('/api/facturacion/mi-plan/validar-retorno').set(H).send(body).expect(201);
    expect(r.body).toEqual({ valido: true, orderStatus: 'PAID' });
    expect((await prisma.cobroSuscripcion.findFirstOrThrow({ where: { tenantId: datos.a.tenantId } })).estado).toBe(cobroAntes.estado);
    expect(await prisma.eventoIzipay.count()).toBe(0);
    expect(await prisma.webhookEvent.count({ where: { eventId: { startsWith: 'izipay:' } } })).toBe(0);
    // La firma del retorno no se acepta como notificación servidor-a-servidor.
    await http().post('/api/webhooks/izipay').send(body).expect(401);
    const ipn = { ...body, 'kr-hash-key': 'password',
      'kr-hash': createHmac('sha256', 'rest-test').update(body['kr-answer']).digest('hex') };
    await http().post('/api/webhooks/izipay').send(ipn).expect(200);
    // El IPN puede adelantarse al retorno; este sigue validando contra el intento.
    await http().post('/api/facturacion/mi-plan/validar-retorno').set(H).send(body).expect(201);
    expect(await prisma.eventoIzipay.count()).toBe(1);
  });
  it('retorno con firma inválida o clave de IPN se rechaza sin conciliar', async () => {
    const body = await aviso({ key: 'sha256_hmac' });
    await http().post('/api/facturacion/mi-plan/validar-retorno').set(H)
      .send({ ...body, 'kr-hash': '0'.repeat(64) }).expect(401);
    const ipn = { ...body, 'kr-hash-key': 'password',
      'kr-hash': createHmac('sha256', 'rest-test').update(body['kr-answer']).digest('hex') };
    await http().post('/api/facturacion/mi-plan/validar-retorno').set(H).send(ipn).expect(401);
    expect((await prisma.cobroSuscripcion.findFirstOrThrow({ where: { tenantId: datos.a.tenantId } })).estado).toBe('pendiente');
    expect(await prisma.eventoIzipay.count()).toBe(0);
  });
  it('retorno firmado debe conciliar importe, moneda, orden y clínica', async () => {
    for (const opciones of [{ amount: 100 }, { currency: 'USD' }, { orderId: 'desconocido' }]) {
      const body = await aviso({ ...opciones, key: 'sha256_hmac' });
      await http().post('/api/facturacion/mi-plan/validar-retorno').set(H).send(body).expect(400);
    }
    const orderId = randomUUID();
    const cobroB = await prisma.cobroSuscripcion.create({ data: { tenantId: datos.b.tenantId,
      proveedor: 'izipay', monto: 249, moneda: 'PEN', claveIdempotencia: `chk-b-${orderId}`,
      periodoInicio: new Date(), periodoFin: new Date(), metadata: {} } });
    await prisma.intentoIzipay.create({ data: { orderId, tenantId: datos.b.tenantId, usuarioId: datos.b.userId,
      cobroSuscripcionId: cobroB.id, importeCentimos: 24900n, moneda: 'PEN', metadata: {} } });
    // Importe deliberadamente distinto al del plan: lo que debe conciliar aquí
    // es el tenant; el importe viene del intento creado a mano.
    const ajeno = await aviso({ orderId, amount: 24900, key: 'sha256_hmac' });
    await http().post('/api/facturacion/mi-plan/validar-retorno').set(H).send(ajeno).expect(400);
    await http().post('/api/facturacion/mi-plan/validar-retorno').set(HB).send(ajeno).expect(201);
    expect(await prisma.eventoIzipay.count()).toBe(0);
    await prisma.intentoIzipay.deleteMany({});
    await prisma.cobroSuscripcion.deleteMany({ where: { tenantId: datos.b.tenantId } });
  });
  it('firma inválida devuelve 401 sin cambiar cobros, eventos ni auditoría', async () => {
    const body = await aviso();
    await new Promise((resolve) => setTimeout(resolve, 100)); // Auditoría asíncrona del formToken.
    const cobroAntes = await prisma.cobroSuscripcion.findFirstOrThrow({ where: { tenantId: datos.a.tenantId } });
    const auditorias = await prisma.auditoria.count();
    await http().post('/api/webhooks/izipay').send({ ...body, 'kr-hash': '0'.repeat(64) }).expect(401);
    await http().post('/api/webhooks/izipay/').send({ ...body, 'kr-hash': '0'.repeat(64) }).expect(401);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await prisma.cobroSuscripcion.findFirstOrThrow({ where: { tenantId: datos.a.tenantId } })).toEqual(cobroAntes);
    expect(await prisma.eventoIzipay.count()).toBe(0);
    expect(await prisma.auditoria.count()).toBe(auditorias);
    await http().post('/api/webhooks/izipay').send({ ...body, 'kr-answer': JSON.stringify(JSON.parse(body['kr-answer'])) }).expect(401);
  });
  it('la misma IPN dos veces paga UNA vez y NO extiende el periodo dos veces', async () => {
    const body = await aviso();
    const enviar = () => http().post('/api/webhooks/izipay').send(body);
    await enviar().expect(200);
    const trasPrimero = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: datos.a.tenantId } });
    expect((await prisma.cobroSuscripcion.findFirstOrThrow({ where: { tenantId: datos.a.tenantId } })).estado).toBe('pagado');
    const respuestas = await Promise.all([enviar(), enviar(), enviar()]);
    expect(respuestas.map((r) => r.status)).toEqual([200, 200, 200]);
    await enviar().expect(200);
    const trasReintentos = await prisma.subscription.findUniqueOrThrow({ where: { tenantId: datos.a.tenantId } });
    expect(trasReintentos.periodoFin.getTime()).toBe(trasPrimero.periodoFin.getTime());
    expect(await prisma.eventoIzipay.count()).toBe(1);
    expect(await prisma.webhookEvent.count({ where: { eventId: { startsWith: 'izipay:' } } })).toBe(1);
  });
  it('orden desconocida se audita y no acredita nada', async () => {
    await token().expect(201);
    const body = await aviso({ orderId: 'desconocido' });
    await http().post('/api/webhooks/izipay').send(body).expect(200);
    expect((await prisma.cobroSuscripcion.findFirstOrThrow({ where: { tenantId: datos.a.tenantId } })).estado).toBe('pendiente');
    expect(await prisma.eventoIzipay.findFirst()).toMatchObject({ estado: 'orden_desconocida', tenantId: null, cobroSuscripcionId: null });
    expect(await prisma.webhookEvent.count({ where: { eventId: { startsWith: 'izipay:' } } })).toBe(0);
  });
  it('importe o moneda diferentes y rechazo no acreditan', async () => {
    for (const opciones of [{ amount: 100 }, { currency: 'USD' }, { status: 'UNPAID' }]) {
      const body = await aviso(opciones);
      await http().post('/api/webhooks/izipay').send(body).expect(200);
    }
    expect((await prisma.cobroSuscripcion.findFirstOrThrow({ where: { tenantId: datos.a.tenantId } })).estado).toBe('pendiente');
    expect(await prisma.webhookEvent.count({ where: { eventId: { startsWith: 'izipay:' } } })).toBe(0);
  });
  it('rechaza algoritmo y selector de clave no reconocidos', async () => {
    const body = await aviso();
    await http().post('/api/webhooks/izipay').send({ ...body, 'kr-hash-key': 'otro' }).expect(401);
    await http().post('/api/webhooks/izipay').send({ ...body, 'kr-hash-algorithm': 'sha1' }).expect(401);
  });
  it('sin billing.manage devuelve 403 (payments.write no sirve)', async () => {
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: datos.a.roleId, permissionId: 'perm-billing.manage' } } });
    try {
      await token().expect(403);
      await http().post('/api/facturacion/mi-plan/validar-retorno').set(H).send({}).expect(403);
      await http().get('/api/facturacion/mi-plan').set(H).expect(403);
    }
    finally { await prisma.rolePermission.create({ data: { roleId: datos.a.roleId, permissionId: 'perm-billing.manage' } }); }
  });
  it('el endpoint de formtoken de pagos ya no existe', async () => {
    await http().post(`/api/pagos/xyz/izipay/formtoken`).set(H).expect(404);
    await http().post(`/api/pagos/xyz/izipay/validar`).set(H).send({}).expect(404);
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
  it('mi-plan refleja el cobro pendiente y su pago tras la IPN', async () => {
    const estado1 = await http().get('/api/facturacion/mi-plan').set(H).expect(200);
    expect(estado1.body.plan.codigo).toBe('clinica');
    expect(estado1.body.subscription.estado).toBe('ACTIVE');
    expect(estado1.body.cobroPendiente).toBeNull();
    await token().expect(201);
    const estado2 = await http().get('/api/facturacion/mi-plan').set(H).expect(200);
    expect(Number(estado2.body.cobroPendiente.monto)).toBe(249);
    expect(estado2.body.cobroPendiente).toMatchObject({ comision: '11.39', total: '260.39' });
    const cuerpo = await aviso();
    await http().post('/api/webhooks/izipay').send(cuerpo).expect(200);
    const estado3 = await http().get('/api/facturacion/mi-plan').set(H).expect(200);
    expect(estado3.body.cobroPendiente).toBeNull();
    expect(estado3.body.cobros[0].estado).toBe('pagado');
  });
});
