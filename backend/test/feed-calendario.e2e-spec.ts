/**
 * Feed ICS suscribible (`GET /api/agenda/:token.ics`) y gestión de feeds.
 *
 * Fija los invariantes auditados:
 *  1. El feed es de solo lectura (GET público que no escribe nada).
 *  2. El token es la única autenticación y el aislamiento se prueba SOBRE EL
 *     CONTENIDO del ICS (nombres de B ausentes en el texto de A).
 *  3. UID estable: reprogramar actualiza, no duplica.
 *  4. Horas en UTC correctas (Lima = UTC-5 fijo): 09:00 → 14:00Z y
 *     20:00 → 01:00Z del día siguiente.
 *  5. Nada de OAuth ni de Google Cloud (no hay rutas ni campos para eso).
 *  6. `GET /api/citas` y sus permisos no cambian (control al final).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import {
  PASSWORD_PLAIN,
  limpiarDosTenants,
  seedDosTenants,
  type DosTenants,
} from './helpers/tenants-fixture.js';

/** Fecha civil `YYYY-MM-DD` a N días desde hoy (en UTC, como la guarda `@db.Date`). */
function fechaCivilMas(dias: number): string {
  const ahora = new Date();
  const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate() + dias));
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/** Suma días a una fecha civil `YYYY-MM-DD`. */
function masDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

function lineasIcs(texto: string): string[] {
  return texto.split('\r\n');
}

describe('Feed ICS suscribible', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let HA: Record<string, string>;
  let HB: Record<string, string>;

  const dia = fechaCivilMas(7);
  const diaSiguiente = masDias(dia, 1);

  let tokenFeed = '';
  let feedId = '';
  let citaMananaId = '';
  let citaNocheId = '';

  const NOMBRE_B = 'Inconfundible-Beta-Zxq';
  const SECRETO_CLINICO = 'NOTA_CLINICA_SECRETA_7391';

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    const srv = app.getHttpServer();
    const loginA = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    HA = { Authorization: `Bearer ${loginA.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
    const loginB = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.b.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    HB = { Authorization: `Bearer ${loginB.body.access_token}`, 'X-Tenant-Id': datos.b.tenantId };

    const db = prisma as unknown as {
      cita: { create: (a: unknown) => Promise<{ id: string }> };
      paciente: { update: (a: unknown) => Promise<unknown> };
    };

    // Cita de mañana (09:00 Lima = 14:00Z) con observación clínica que NO debe filtrarse.
    const manana = await db.cita.create({
      data: {
        tenantId: datos.a.tenantId,
        token: 'CIT-FEED-01',
        pacienteId: datos.a.pacienteId,
        tratamientoId: datos.a.tratamientoId,
        sedeId: datos.a.sedeId,
        fecha: new Date(`${dia}T00:00:00.000Z`),
        horaInicio: '09:00',
        horaFin: '09:30',
        estado: 'pendiente',
        observacion: SECRETO_CLINICO,
      },
    });
    citaMananaId = manana.id;

    // Cita nocturna (20:00 Lima = 01:00Z del día siguiente).
    const noche = await db.cita.create({
      data: {
        tenantId: datos.a.tenantId,
        token: 'CIT-FEED-02',
        pacienteId: datos.a.pacienteId,
        tratamientoId: datos.a.tratamientoId,
        sedeId: datos.a.sedeId,
        fecha: new Date(`${dia}T00:00:00.000Z`),
        horaInicio: '20:00',
        horaFin: '20:30',
        estado: 'confirmada',
      },
    });
    citaNocheId = noche.id;

    // Cancelada: debe excluirse aunque esté en la ventana.
    await db.cita.create({
      data: {
        tenantId: datos.a.tenantId,
        token: 'CIT-FEED-03',
        pacienteId: datos.a.pacienteId,
        sedeId: datos.a.sedeId,
        fecha: new Date(`${dia}T00:00:00.000Z`),
        horaInicio: '11:00',
        horaFin: '11:30',
        estado: 'cancelada',
      },
    });

    // Clínica B con un paciente de nombre inconfundible (prueba de aislamiento
    // SOBRE EL CONTENIDO, no sobre recuentos).
    await db.paciente.update({
      where: { id: datos.b.pacienteId },
      data: { nombres: 'Paciente', apellidos: NOMBRE_B },
    });
    await db.cita.create({
      data: {
        tenantId: datos.b.tenantId,
        token: 'CIT-FEED-B1',
        pacienteId: datos.b.pacienteId,
        tratamientoId: datos.b.tratamientoId,
        sedeId: datos.b.sedeId,
        fecha: new Date(`${dia}T00:00:00.000Z`),
        horaInicio: '09:00',
        horaFin: '09:30',
        estado: 'confirmada',
      },
    });

    // El feed se crea por API (como lo haría la pantalla de Configuración).
    const feed = await request(srv).post('/api/feeds-calendario').set(HA).send({}).expect(201);
    feedId = String(feed.body.id);
    tokenFeed = String(feed.body.token);
    expect(tokenFeed.length).toBeGreaterThanOrEqual(32);
  }, 120_000);

  afterAll(async () => {
    if (prisma) await limpiarDosTenants(prisma);
    if (app) await app.close();
  });

  async function descargar(token: string): Promise<{ status: number; texto: string; headers: Record<string, string> }> {
    const r = await request(app.getHttpServer()).get(`/api/agenda/${token}.ics`);
    return { status: r.status, texto: r.text ?? '', headers: r.headers as Record<string, string> };
  }

  it('sirve el ICS sin autenticación, con cabeceras de calendario', async () => {
    const { status, texto, headers } = await descargar(tokenFeed);
    expect(status).toBe(200);
    expect(String(headers['content-type'])).toContain('text/calendar');
    expect(String(headers['content-disposition'])).toContain('inline');
    expect(texto).toContain('BEGIN:VCALENDAR');
    expect(texto).toContain('END:VCALENDAR');
    expect(texto).toContain('BEGIN:VEVENT');
  });

  it('convierte 09:00 Lima → 14:00Z y 20:00 Lima → 01:00Z del día siguiente', async () => {
    const { texto } = await descargar(tokenFeed);
    const compacto = texto.replace(/\r\n /g, '');
    expect(compacto).toContain(`DTSTART:${dia.replaceAll('-', '')}T140000Z`);
    expect(compacto).toContain(`DTSTART:${diaSiguiente.replaceAll('-', '')}T010000Z`);
  });

  it('el UID es estable: reprogramar actualiza el evento en lugar de duplicarlo', async () => {
    const antes = (await descargar(tokenFeed)).texto;
    const uid = `UID:cita-${citaMananaId}@dental-saas`;
    expect(antes).toContain(uid);
    const ocurrencias = (texto: string): number => texto.split(uid).length - 1;
    expect(ocurrencias(antes)).toBe(1);

    // Reprogramación por API: la hora cambia de 09:00 a 10:00.
    await request(app.getHttpServer())
      .patch(`/api/citas/${citaMananaId}`)
      .set(HA)
      .send({ horaInicio: '10:00', horaFin: '10:30' })
      .expect(200);

    const despues = (await descargar(tokenFeed)).texto;
    expect(despues).toContain(uid);
    expect(ocurrencias(despues)).toBe(1);
    const compacto = despues.replace(/\r\n /g, '');
    expect(compacto).toContain(`DTSTART:${dia.replaceAll('-', '')}T150000Z`);
    expect(compacto).not.toContain(`DTSTART:${dia.replaceAll('-', '')}T140000Z`);
  });

  it('excluye las citas canceladas', async () => {
    const { texto } = await descargar(tokenFeed);
    // La cancelada era la única a las 11:00.
    expect(texto.replace(/\r\n /g, '')).not.toContain('T110000Z');
  });

  it('usa CRLF en todas las líneas y las pliega a 75 octetos', async () => {
    const { texto } = await descargar(tokenFeed);
    expect(texto).toContain('\r\n');
    expect(texto).not.toMatch(/[^\r]\n/);
    for (const l of lineasIcs(texto)) {
      if (l === '') continue; // el documento termina en CRLF
      expect(Buffer.byteLength(l, 'utf8')).toBeLessThanOrEqual(75);
    }
  });

  it('aislamiento: el feed de A no contiene NINGUNA cita de B (sobre el texto)', async () => {
    const { texto } = await descargar(tokenFeed);
    expect(texto).not.toContain(NOMBRE_B);
    expect(texto).not.toContain('CIT-FEED-B1');
    expect(texto).not.toContain(datos.b.tenantId);
    expect(texto).not.toContain(datos.b.citaId);
  });

  it('no expone campos internos: ni observaciones clínicas, ni importes, ni ids ajenos', async () => {
    const { texto } = await descargar(tokenFeed);
    expect(texto).not.toContain(SECRETO_CLINICO);
    expect(texto.toLowerCase()).not.toContain('observacion');
    for (const palabra of ['importe', 'monto', 'diagnostico', 'diagnóstico', 'nota']) {
      expect(texto.toLowerCase()).not.toContain(palabra);
    }
    expect(texto).not.toContain(datos.a.tratamientoId);
  });

  it('token inválido → 404 y token desactivado → 404', async () => {
    await descargar('token-que-no-existe-12345').then(({ status }) => expect(status).toBe(404));
    await request(app.getHttpServer())
      .patch(`/api/feeds-calendario/${feedId}`)
      .set(HA)
      .send({ activo: false })
      .expect(200);
    await descargar(tokenFeed).then(({ status }) => expect(status).toBe(404));
    // Reactivar vuelve a servir (revocable en un clic, en ambos sentidos).
    await request(app.getHttpServer())
      .patch(`/api/feeds-calendario/${feedId}`)
      .set(HA)
      .send({ activo: true })
      .expect(200);
    await descargar(tokenFeed).then(({ status }) => expect(status).toBe(200));
  });

  it('regenerar revoca la URL vieja y entrega una nueva que sí sirve', async () => {
    const r = await request(app.getHttpServer())
      .post(`/api/feeds-calendario/${feedId}/regenerar`)
      .set(HA)
      .expect(201);
    const nuevo = String(r.body.token);
    expect(nuevo).not.toBe(tokenFeed);
    await descargar(tokenFeed).then(({ status }) => expect(status).toBe(404));
    await descargar(nuevo).then(({ status }) => expect(status).toBe(200));
    tokenFeed = nuevo;
  });

  it('no permite crear feeds contra sede o dentista de otra clínica', async () => {
    await request(app.getHttpServer())
      .post('/api/feeds-calendario')
      .set(HA)
      .send({ sedeId: datos.b.sedeId })
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/feeds-calendario')
      .set(HA)
      .send({ dentistaId: 'tb-membership-falsa' })
      .expect(404);
  });

  it('el feed filtrado por sede solo trae citas de esa sede', async () => {
    const db = prisma as unknown as {
      sede: { create: (a: unknown) => Promise<{ id: string }> };
      cita: { create: (a: unknown) => Promise<{ id: string }> };
    };
    const otra = await db.sede.create({
      data: { tenantId: datos.a.tenantId, nombre: 'Sede filtrada fuera' },
    });
    const fuera = await db.cita.create({
      data: {
        tenantId: datos.a.tenantId,
        token: 'CIT-FEED-04',
        pacienteId: datos.a.pacienteId,
        sedeId: otra.id,
        fecha: new Date(`${dia}T00:00:00.000Z`),
        horaInicio: '16:00',
        horaFin: '16:30',
        estado: 'confirmada',
      },
    });
    const r = await request(app.getHttpServer())
      .post('/api/feeds-calendario')
      .set(HA)
      .send({ sedeId: datos.a.sedeId })
      .expect(201);
    const { texto } = await descargar(String(r.body.token));
    // 16:00 Lima = 21:00Z: la cita de la otra sede no debe aparecer.
    expect(texto.replace(/\r\n /g, '')).not.toContain('T210000Z');
    expect(texto).not.toContain(`cita-${fuera.id}@dental-saas`);
    // Pero el feed sin filtro sí la trae.
    const { texto: completo } = await descargar(tokenFeed);
    expect(completo).toContain(`cita-${fuera.id}@dental-saas`);
  });

  it('sin sesión no se listan feeds (401) y B no ve los tokens de A', async () => {
    await request(app.getHttpServer()).get('/api/feeds-calendario').expect(401);
    const r = await request(app.getHttpServer()).get('/api/feeds-calendario').set(HB).expect(200);
    expect(JSON.stringify(r.body)).not.toContain(tokenFeed);
  });

  it('control: GET /api/citas y sus permisos no cambian', async () => {
    await request(app.getHttpServer()).get('/api/citas').set(HA).expect(200);
    await request(app.getHttpServer()).get('/api/citas').expect(401);
  });

  it('control: el feed es de solo lectura (no existe escritura pública)', async () => {
    await request(app.getHttpServer()).post(`/api/agenda/${tokenFeed}.ics`).send({}).expect(404);
    // Y servir el feed no escribe nada: el número de citas de A no cambia.
    const db = prisma as unknown as { cita: { count: (a: unknown) => Promise<number> } };
    const n = await db.cita.count({ where: { tenantId: datos.a.tenantId } });
    await descargar(tokenFeed);
    expect(await db.cita.count({ where: { tenantId: datos.a.tenantId } })).toBe(n);
  });
});
