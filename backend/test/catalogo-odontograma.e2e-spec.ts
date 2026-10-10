/**
 * Catálogo NTS 188 y reglas del odontograma.
 *
 * Cubre los huecos que quedaban antes del editor gráfico:
 *  1. `GET /api/odontogramas/catalogo`: la paleta del editor (qué hallazgos
 *     hay, cuáles exigen superficie o material y de qué color van). Incluye
 *     que `:id` NO la captura.
 *  2. El seed siembra el catálogo de forma idempotente (dos pasadas no
 *     duplican): se ejerce la MISMA función que usan `db:seed` y
 *     `db:seed-demo`, no una copia.
 *  3. Las reglas del catálogo al añadir: superficies y material obligatorios
 *     se validan en el servidor, y `estadoClinico`/`color` se DERIVAN del
 *     catálogo (el cliente no los fija: el whitelist los rechaza).
 *  4. Anular conserva la fila (`activo=false`) con su evento de traza.
 *  5. Firmado bloquea añadir/anular y la doble firma se rechaza.
 *  6. Versionado v1/v2 y aislamiento entre clínicas.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { CATALOGO_HALLAZGOS } from '../src/core/catalogo/hallazgos.js';
import { sembrarCatalogoHallazgos } from '../prisma/seed-data.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

/** Mensaje del `message` de Nest, que puede venir como cadena o como array. */
function textoMensaje(body: unknown): string {
  const m = (body as { message?: unknown }).message;
  if (Array.isArray(m)) return m.join(' | ');
  return typeof m === 'string' ? m : '';
}

type Evento = { id: string; pieza: string; estadoNuevo: string };
type Hallazgo = { id: string; activo: boolean };
type Codigo = { codigo: string };

type Db = {
  hallazgoCatalogo: {
    count: (a: unknown) => Promise<number>;
    findMany: (a: unknown) => Promise<Codigo[]>;
  };
  odontogramaHallazgo: {
    findUnique: (a: unknown) => Promise<Hallazgo | null>;
  };
  odontogramaEvento: { findMany: (a: unknown) => Promise<Evento[]> };
};

describe('Catálogo NTS 188 y reglas del odontograma', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let H: Record<string, string>;
  let HB: Record<string, string>;
  /** Odontograma en borrador para las pruebas de reglas (no se firma). */
  let odontoReglas = '';

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;

    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    const srv = app.getHttpServer();
    const loginA = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    H = { Authorization: `Bearer ${loginA.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };

    const loginB = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.b.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    HB = { Authorization: `Bearer ${loginB.body.access_token}`, 'X-Tenant-Id': datos.b.tenantId };

    const od = await request(srv)
      .post('/api/odontogramas')
      .set(H)
      .send({ pacienteId: datos.a.pacienteId, fecha: '2026-03-10', piezas: {} })
      .expect(201);
    odontoReglas = String(od.body.id);
  }, 120_000);

  afterAll(async () => {
    if (prisma) await limpiarDosTenants(prisma);
    if (app) await app.close();
  });

  const http = () => request(app.getHttpServer());

  // ---------------------------------------------------------------- catálogo

  it('el catálogo expone los hallazgos activos con las 7 propiedades (y `:id` no lo captura)', async () => {
    const r = await http().get('/api/odontogramas/catalogo').set(H).expect(200);

    // Si `:id` capturara `catalogo`, esto sería un 404 («no encontrado») o
    // un odontograma: tiene que ser una LISTA de hallazgos.
    expect(Array.isArray(r.body)).toBe(true);
    const lista = r.body as Array<Record<string, unknown>>;
    expect(lista).toHaveLength(CATALOGO_HALLAZGOS.length);

    // `select` explícito: ni `id` interno, ni `activo`, ni `version`.
    const claves = [
      'abreviatura',
      'alcance',
      'codigo',
      'colorDefecto',
      'nombre',
      'requiereMaterial',
      'requiereSuperficie',
    ];
    for (const h of lista) expect(Object.keys(h).sort()).toEqual(claves);

    // Los dos códigos que ya usaban las pruebas se conservan EXACTOS.
    expect(lista.find((h) => h.codigo === 'CARIES')).toEqual({
      codigo: 'CARIES',
      nombre: 'Lesión de caries dental',
      abreviatura: 'C',
      alcance: 'superficie',
      requiereSuperficie: true,
      requiereMaterial: false,
      colorDefecto: 'rojo',
    });
    expect(lista.find((h) => h.codigo === 'OBTURADO')).toEqual({
      codigo: 'OBTURADO',
      nombre: 'Restauración',
      abreviatura: 'O',
      alcance: 'superficie',
      requiereSuperficie: true,
      requiereMaterial: true,
      colorDefecto: 'azul',
    });
  });

  it('el seed siembra el catálogo de forma idempotente (dos pasadas no duplican)', async () => {
    // El fixture ya lo sembró al arrancar este spec.
    const antes = await db.hallazgoCatalogo.count({});
    expect(antes).toBe(CATALOGO_HALLAZGOS.length);

    // La MISMA función que usan `db:seed` y `db:seed-demo`.
    const n1 = await sembrarCatalogoHallazgos(prisma);
    const enMedio = await db.hallazgoCatalogo.count({});
    const n2 = await sembrarCatalogoHallazgos(prisma);
    const despues = await db.hallazgoCatalogo.count({});

    expect(n1).toBe(CATALOGO_HALLAZGOS.length);
    expect(n2).toBe(CATALOGO_HALLAZGOS.length);
    expect(enMedio).toBe(antes);
    expect(despues).toBe(antes);

    const codigos = (await db.hallazgoCatalogo.findMany({ select: { codigo: true } })).map(
      (h) => h.codigo,
    );
    for (const h of CATALOGO_HALLAZGOS) expect(codigos).toContain(h.codigo);
  });

  // ------------------------------------------------------- reglas del catálogo

  it('sin superficies cuando `requiereSuperficie` → 400', async () => {
    const r = await http()
      .post(`/api/odontogramas/${odontoReglas}/hallazgos`)
      .set(H)
      .send({ pieza: '16', hallazgoCodigo: 'CARIES' });

    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(textoMensaje(r.body)).toContain('superficie');
  });

  it('con superficies cuando `alcance` es pieza → 400', async () => {
    const r = await http()
      .post(`/api/odontogramas/${odontoReglas}/hallazgos`)
      .set(H)
      .send({ pieza: '16', hallazgoCodigo: 'AUSENTE', superficies: ['O'] });

    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(textoMensaje(r.body)).toContain('pieza');
  });

  it('sin material cuando `requiereMaterial` → 400', async () => {
    const r = await http()
      .post(`/api/odontogramas/${odontoReglas}/hallazgos`)
      .set(H)
      .send({ pieza: '16', hallazgoCodigo: 'OBTURADO', superficies: ['O'] });

    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(textoMensaje(r.body)).toContain('material');
  });

  it('camino feliz: CARIES deriva `estadoClinico` y `color` del catálogo', async () => {
    const r = await http()
      .post(`/api/odontogramas/${odontoReglas}/hallazgos`)
      .set(H)
      .send({ pieza: '17', hallazgoCodigo: 'CARIES', superficies: ['O'] });

    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // Rojo NTS 188 = patología: lo decide el servidor, no el cliente.
    expect(r.body.estadoClinico).toBe('patologico');
    expect(r.body.color).toBe('rojo');
  });

  it('camino feliz: OBTURADO con material deriva tratado/azul', async () => {
    const r = await http()
      .post(`/api/odontogramas/${odontoReglas}/hallazgos`)
      .set(H)
      .send({ pieza: '26', hallazgoCodigo: 'OBTURADO', superficies: ['O'], material: 'resina' });

    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // Azul NTS 188 = tratamiento realizado.
    expect(r.body.estadoClinico).toBe('tratado');
    expect(r.body.color).toBe('azul');
    expect(r.body.material).toBe('resina');
  });

  it('el cliente no puede fijar `estadoClinico` ni `color` (whitelist)', async () => {
    const r = await http()
      .post(`/api/odontogramas/${odontoReglas}/hallazgos`)
      .set(H)
      .send({
        pieza: '16',
        hallazgoCodigo: 'CARIES',
        superficies: ['O'],
        estadoClinico: 'sano',
        color: 'verde',
      });

    expect(r.status, JSON.stringify(r.body)).toBe(400);
    const texto = textoMensaje(r.body);
    expect(texto).toContain('estadoClinico');
    expect(texto).toContain('color');
  });

  // ------------------------------------------------------------- anular/firma

  it('anular conserva la fila con `activo=false` y escribe el evento de traza', async () => {
    const creado = await http()
      .post(`/api/odontogramas/${odontoReglas}/hallazgos`)
      .set(H)
      .send({ pieza: '36', hallazgoCodigo: 'CARIES', superficies: ['O'] })
      .expect(201);
    const hallazgoId = String(creado.body.id);

    await http()
      .patch(`/api/odontogramas/${odontoReglas}/hallazgos/${hallazgoId}/anular`)
      .set(H)
      .expect(200);

    const h = await db.odontogramaHallazgo.findUnique({ where: { id: hallazgoId } });
    expect(h, 'el hallazgo desapareció: debía anularse, no borrarse').not.toBeNull();
    expect(h!.activo).toBe(false);

    const eventos = await db.odontogramaEvento.findMany({
      where: { odontogramaId: odontoReglas, pieza: '36' },
    });
    expect(eventos.some((e) => e.estadoNuevo === 'anulado')).toBe(true);
  });

  it('firmado: bloquea añadir y anular; la doble firma se rechaza', async () => {
    const od = await http()
      .post('/api/odontogramas')
      .set(H)
      .send({ pacienteId: datos.a.pacienteId, fecha: '2026-03-11', piezas: {} })
      .expect(201);
    const odId = String(od.body.id);

    const hal = await http()
      .post(`/api/odontogramas/${odId}/hallazgos`)
      .set(H)
      .send({ pieza: '46', hallazgoCodigo: 'CARIES', superficies: ['O'] })
      .expect(201);
    const hallazgoId = String(hal.body.id);

    await http().patch(`/api/odontogramas/${odId}/firmar`).set(H).expect(200);
    // Firmar dos veces se rechaza (no es idempotente a propósito: la segunda
    // firma con otro usuario cambiaría `firmadoPor` sin dejar traza).
    await http().patch(`/api/odontogramas/${odId}/firmar`).set(H).expect(400);

    await http()
      .post(`/api/odontogramas/${odId}/hallazgos`)
      .set(H)
      .send({ pieza: '47', hallazgoCodigo: 'CARIES', superficies: ['O'] })
      .expect(400);
    await http()
      .patch(`/api/odontogramas/${odId}/hallazgos/${hallazgoId}/anular`)
      .set(H)
      .expect(400);
  });

  // ------------------------------------------------------ versionado/aislamiento

  it('crear dos veces versiona v1 y v2 para el mismo paciente', async () => {
    const pac = await http()
      .post('/api/pacientes')
      .set(H)
      .send({ nombres: 'Version', apellidos: 'Test' })
      .expect(201);
    const pid = String((pac.body as { id: string }).id);

    const v1 = await http()
      .post('/api/odontogramas')
      .set(H)
      .send({ pacienteId: pid, fecha: '2026-03-10', piezas: {} })
      .expect(201);
    const v2 = await http()
      .post('/api/odontogramas')
      .set(H)
      .send({ pacienteId: pid, fecha: '2026-03-11', piezas: {} })
      .expect(201);

    expect(v1.body.version).toBe(1);
    expect(v2.body.version).toBe(2);
  });

  it('aislamiento: el odontograma de otra clínica no se lee (404)', async () => {
    await http().get(`/api/odontogramas/${datos.b.odontogramaId}`).set(H).expect(404);
    await http().get(`/api/odontogramas/${datos.a.odontogramaId}`).set(HB).expect(404);
  });
});
