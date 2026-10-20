/**
 * Rango de `GET /citas` (vista de mes) y rejilla de `GET /citas/disponibilidad`.
 *
 * La disponibilidad usa la MISMA `evaluarFranja` que el guardado: lo que aquí
 * sale `disponible: true` se puede agendar, y lo marcado (`pasado`, `fuera de
 * horario`, `descanso`, `ocupado`) el guardado lo rechaza con el mismo motivo.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

const HORARIO = {
  lun: { inicio: '09:00', fin: '19:00' },
  mar: { inicio: '09:00', fin: '19:00' },
  mie: { inicio: '09:00', fin: '19:00' },
  jue: { inicio: '09:00', fin: '19:00' },
  vie: { inicio: '09:00', fin: '19:00' },
  sab: { inicio: '09:00', fin: '13:00' },
  dom: null,
};

function fechaCivilMas(dias: number): string {
  const ahora = new Date();
  const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate() + dias));
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

function masDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + dias));
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** Próxima fecha civil que cae en el día de semana pedido (0=dom … 6=sab). */
function proximoDia(diaSemana: number, minDias = 7): string {
  for (let i = minDias; i < minDias + 7; i++) {
    const iso = fechaCivilMas(i);
    if (new Date(`${iso}T00:00:00.000Z`).getUTCDay() === diaSemana) return iso;
  }
  throw new Error('sin día');
}

describe('Rango de citas y disponibilidad', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let HA: Record<string, string>;
  let HB: Record<string, string>;

  const lunes = proximoDia(1);
  const miercoles = masDias(lunes, 2);
  const viernes = masDias(lunes, 4);
  const domingo = masDias(lunes, 6);

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);

    prisma = app.get(PrismaService);
    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    await prisma.tenantConfig.upsert({
      where: { tenantId: datos.a.tenantId },
      update: { horario: HORARIO, descansos: [] },
      create: { tenantId: datos.a.tenantId, nombre: 'Clínica A', horario: HORARIO, descansos: [] },
    });

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

    const db = prisma as unknown as { cita: { create: (a: unknown) => Promise<unknown> } };
    for (const [i, dia] of [lunes, miercoles, viernes].entries()) {
      await db.cita.create({
        data: {
          tenantId: datos.a.tenantId,
          token: `CIT-RANGO-0${i}`,
          pacienteId: datos.a.pacienteId,
          sedeId: datos.a.sedeId,
          fecha: new Date(`${dia}T00:00:00.000Z`),
          horaInicio: '10:00',
          horaFin: '10:30',
          estado: 'confirmada',
        },
      });
    }
  }, 120_000);

  afterAll(async () => {
    if (prisma) await limpiarDosTenants(prisma);
    if (app) await app.close();
  });

  it('el rango trae los 3 días y un solo día trae 1', async () => {
    const srv = app.getHttpServer();
    const rango = await request(srv)
      .get(`/api/citas?desde=${lunes}&hasta=${viernes}`)
      .set(HA)
      .expect(200);
    const tokens = (rango.body as Array<{ token: string }>).map((c) => c.token);
    expect(tokens).toContain('CIT-RANGO-00');
    expect(tokens).toContain('CIT-RANGO-01');
    expect(tokens).toContain('CIT-RANGO-02');
    // Sin filtro de clínica cruzada: la cita del fixture de B (2026-03-10) no está en el rango.
    expect(tokens).not.toContain(datos.b.citaToken);

    // Control real de aislamiento: un rango que SÍ incluye la cita de B no la
    // devuelve (antes la aserción pasaba solo porque estaba fuera del rango).
    const cruzado = await request(srv)
      .get('/api/citas?desde=2026-03-09&hasta=2026-03-11')
      .set(HA)
      .expect(200);
    expect((cruzado.body as Array<{ token: string }>).map((c) => c.token)).not.toContain(
      datos.b.citaToken,
    );

    const dia = await request(srv).get(`/api/citas?fecha=${miercoles}`).set(HA).expect(200);
    expect((dia.body as Array<{ token: string }>).map((c) => c.token)).toEqual(['CIT-RANGO-01']);
  });

  it('rango inválido: hasta anterior, más de 62 días, o fecha+rango', async () => {
    const srv = app.getHttpServer();
    await request(srv).get(`/api/citas?desde=${viernes}&hasta=${lunes}`).set(HA).expect(400);
    await request(srv).get(`/api/citas?desde=${lunes}&hasta=${masDias(lunes, 63)}`).set(HA).expect(400);
    await request(srv).get(`/api/citas?fecha=${lunes}&desde=${lunes}`).set(HA).expect(400);
    await request(srv).get(`/api/citas?fecha=no-es-fecha`).set(HA).expect(400);
    // Fecha imposible o instante con hora: el dominio es una fecha civil y
    // guardar el instante truncado en UTC cambiaría de día.
    await request(srv).get('/api/citas?fecha=2026-02-30').set(HA).expect(400);
    await request(srv)
      .get(`/api/citas/disponibilidad?fecha=2026-02-30&duracion=30`)
      .set(HA)
      .expect(400);
    await request(srv)
      .post('/api/citas')
      .set(HA)
      .send({
        pacienteId: datos.a.pacienteId,
        sedeId: datos.a.sedeId,
        fecha: `${lunes}T23:00:00-05:00`,
        horaInicio: '09:00',
        horaFin: '09:30',
      })
      .expect(400);
  });

  it('filtros con sede/dentista ajenos → 404; estado desconocido → 400', async () => {
    const srv = app.getHttpServer();
    await request(srv).get(`/api/citas?sedeId=${datos.b.sedeId}`).set(HA).expect(404);
    await request(srv).get(`/api/citas?dentistaId=${datos.b.membershipId}`).set(HA).expect(404);
    await request(srv).get('/api/citas?estado=invento').set(HA).expect(400);
    const r = await request(srv).get('/api/citas?estado=confirmada').set(HA).expect(200);
    expect((r.body as Array<{ estado: string }>).every((c) => c.estado === 'confirmada')).toBe(true);
  });

  it('la rejilla es de 15 minutos desde la apertura y la última permite la duración completa', async () => {
    const srv = app.getHttpServer();
    const r30 = await request(srv)
      .get(`/api/citas/disponibilidad?fecha=${lunes}&duracion=30`)
      .set(HA)
      .expect(200);
    const huecos = r30.body as Array<{ horaInicio: string; disponible: boolean }>;
    expect(huecos[0]!.horaInicio).toBe('09:00');
    expect(huecos[1]!.horaInicio).toBe('09:15');
    // Cierra 19:00 y dura 30: la última es 18:30 (18:45 no cabe completa).
    expect(huecos[huecos.length - 1]!.horaInicio).toBe('18:30');

    const r60 = await request(srv)
      .get(`/api/citas/disponibilidad?fecha=${lunes}&duracion=60`)
      .set(HA)
      .expect(200);
    const h60 = r60.body as Array<{ horaInicio: string }>;
    expect(h60[h60.length - 1]!.horaInicio).toBe('18:00');
  });

  it('marca ocupado lo que choca y libre lo siguiente', async () => {
    // Cita 10:00–10:30 creada en el setup.
    const r = await request(app.getHttpServer())
      .get(`/api/citas/disponibilidad?fecha=${lunes}&duracion=30`)
      .set(HA)
      .expect(200);
    const mapa = new Map(
      (r.body as Array<{ horaInicio: string; disponible: boolean; motivo?: string }>).map((h) => [
        h.horaInicio,
        h,
      ]),
    );
    expect(mapa.get('10:00')).toMatchObject({ disponible: false, motivo: 'ocupado' });
    expect(mapa.get('10:15')).toMatchObject({ disponible: false, motivo: 'ocupado' });
    expect(mapa.get('10:30')).toMatchObject({ disponible: true });
    expect(mapa.get('09:00')).toMatchObject({ disponible: true });
  });

  it('domingo sin atención: todo fuera de horario; día pasado: todo pasado', async () => {
    const srv = app.getHttpServer();
    const dom = await request(srv)
      .get(`/api/citas/disponibilidad?fecha=${domingo}&duracion=30`)
      .set(HA)
      .expect(200);
    const hd = dom.body as Array<{ disponible: boolean; motivo?: string }>;
    expect(hd.length).toBeGreaterThan(0);
    expect(hd.every((h) => !h.disponible && h.motivo === 'fuera de horario')).toBe(true);

    const ayer = fechaCivilMas(-1);
    const pas = await request(srv)
      .get(`/api/citas/disponibilidad?fecha=${ayer}&duracion=30`)
      .set(HA)
      .expect(200);
    const hp = pas.body as Array<{ disponible: boolean; motivo?: string }>;
    expect(hp.length).toBeGreaterThan(0);
    expect(hp.every((h) => !h.disponible && h.motivo === 'pasado')).toBe(true);
  });

  it('descanso del consultorio: todo con motivo descanso', async () => {
    await prisma.tenantConfig.update({
      where: { tenantId: datos.a.tenantId },
      data: { descansos: [{ desde: miercoles, hasta: miercoles, motivo: 'Feriado' }] },
    });
    const r = await request(app.getHttpServer())
      .get(`/api/citas/disponibilidad?fecha=${miercoles}&duracion=30`)
      .set(HA)
      .expect(200);
    const hs = r.body as Array<{ disponible: boolean; motivo?: string }>;
    expect(hs.length).toBeGreaterThan(0);
    expect(hs.every((h) => !h.disponible && h.motivo === 'descanso')).toBe(true);
    await prisma.tenantConfig.update({
      where: { tenantId: datos.a.tenantId },
      data: { descansos: [] },
    });
  });

  it('sin horario configurado es permisivo (07:00–21:00, todo libre)', async () => {
    // B no tiene horario en su TenantConfig: la regla permisiva no se contradice.
    const r = await request(app.getHttpServer())
      .get(`/api/citas/disponibilidad?fecha=${lunes}&duracion=30`)
      .set(HB)
      .expect(200);
    const hs = r.body as Array<{ horaInicio: string; disponible: boolean }>;
    expect(hs[0]!.horaInicio).toBe('07:00');
    expect(hs[hs.length - 1]!.horaInicio).toBe('20:30');
    expect(hs.every((h) => h.disponible)).toBe(true);
  });

  it('una hora disponible se agenda y una ocupada se rechaza (misma regla)', async () => {
    const srv = app.getHttpServer();
    // 09:00 libre el viernes según la rejilla.
    const rejilla = await request(srv)
      .get(`/api/citas/disponibilidad?fecha=${viernes}&duracion=30`)
      .set(HA)
      .expect(200);
    const h9 = (rejilla.body as Array<{ horaInicio: string; disponible: boolean }>).find(
      (h) => h.horaInicio === '09:00',
    );
    expect(h9?.disponible).toBe(true);
    await request(srv)
      .post('/api/citas')
      .set(HA)
      .send({
        pacienteId: datos.a.pacienteId,
        sedeId: datos.a.sedeId,
        fecha: viernes,
        horaInicio: '09:00',
        horaFin: '09:30',
      })
      .expect(201);
    // Y la ocupada (10:00) el guardado la rechaza.
    await request(srv)
      .post('/api/citas')
      .set(HA)
      .send({
        pacienteId: datos.a.pacienteId,
        sedeId: datos.a.sedeId,
        fecha: viernes,
        horaInicio: '10:00',
        horaFin: '10:30',
      })
      .expect(400);
  });

  it('acepta la medianoche UTC heredada al crear y actualizar (compatibilidad)', async () => {
    const srv = app.getHttpServer();
    // El frontend anterior enviaba `aaaa-mm-ddT00:00:00.000Z`; el mismo día en
    // UTC. Se sigue aceptando para no romper bundles antiguos en caché.
    const r = await request(srv)
      .post('/api/citas')
      .set(HA)
      .send({
        pacienteId: datos.a.pacienteId,
        sedeId: datos.a.sedeId,
        fecha: `${lunes}T00:00:00.000Z`,
        horaInicio: '11:00',
        horaFin: '11:30',
      })
      .expect(201);
    expect((r.body as { fecha: string }).fecha.slice(0, 10)).toBe(lunes);

    await request(srv)
      .patch(`/api/citas/${(r.body as { id: string }).id}`)
      .set(HA)
      .send({
        fecha: `${lunes}T00:00:00.000Z`,
        horaInicio: '11:30',
        horaFin: '12:00',
      })
      .expect(200);
  });

  it('sede/dentista ajenos → 404; sin sesión → 401; duración fuera de rango → 400', async () => {
    const srv = app.getHttpServer();
    await request(srv)
      .get(`/api/citas/disponibilidad?fecha=${lunes}&duracion=30&sedeId=${datos.b.sedeId}`)
      .set(HA)
      .expect(404);
    await request(srv)
      .get(`/api/citas/disponibilidad?fecha=${lunes}&duracion=30&dentistaId=${datos.b.membershipId}`)
      .set(HA)
      .expect(404);
    await request(srv).get(`/api/citas/disponibilidad?fecha=${lunes}&duracion=30`).expect(401);
    await request(srv).get(`/api/citas/disponibilidad?fecha=${lunes}&duracion=4`).set(HA).expect(400);
    await request(srv).get(`/api/citas/disponibilidad?fecha=${lunes}&duracion=1441`).set(HA).expect(400);
    await request(srv).get(`/api/citas/disponibilidad?fecha=ayer&duracion=30`).set(HA).expect(400);
  });

  it('un tratamiento de 10 min (mínimo real) también obtiene rejilla', async () => {
    // El contrato de tratamientos permite desde 5 min: la rejilla no puede
    // rechazar esa duración o el formulario se queda sin horas.
    const r = await request(app.getHttpServer())
      .get(`/api/citas/disponibilidad?fecha=${lunes}&duracion=10`)
      .set(HA)
      .expect(200);
    expect((r.body as Array<{ horaInicio: string }>)[0]!.horaInicio).toBe('09:00');
  });
});
