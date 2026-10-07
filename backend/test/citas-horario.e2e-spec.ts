/**
 * Reglas de agenda: horario de atención, descansos y franjas pasadas.
 *
 * POR QUÉ EXISTE: `CitasService` validaba el día de la semana leyendo la fecha en
 * hora **local** (`getDay`), pero las columnas `@db.Date` guardan la fecha civil
 * como medianoche **UTC**. En cualquier huso negativo (Lima, UTC-5) eso desplaza
 * un día: un lunes se leía como domingo. El efecto no era cosmético —
 * **un domingo se aceptaba** (validado como sábado) y un lunes se rechazaba con
 * «El consultorio no atiende el día dom».
 *
 * Los demás specs no lo detectaban por dos motivos: el fixture no configura
 * `TenantConfig.horario` (sin horario la validación no se ejecuta) y en un
 * servidor en UTC no hay desplazamiento. Aquí se configura un horario real y se
 * usan días con horarios DISTINTOS (sábado cierra a las 13:00) para que el día
 * que se valida quede fijado.
 *
 * NOTA DE ENTORNO: el caso del sábado por la tarde es el que discrimina. En un
 * servidor en UTC pasa con o sin el fallo; en un huso negativo solo pasa con la
 * corrección. Ejecutar esta suite con `TZ=America/Lima` reproduce el entorno real.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

/** Lunes a viernes de 9 a 19; sábado solo mañana; domingo cerrado. */
const HORARIO = {
  lun: { inicio: '09:00', fin: '19:00' },
  mar: { inicio: '09:00', fin: '19:00' },
  mie: { inicio: '09:00', fin: '19:00' },
  jue: { inicio: '09:00', fin: '19:00' },
  vie: { inicio: '09:00', fin: '19:00' },
  sab: { inicio: '09:00', fin: '13:00' },
  dom: null,
};

const DOM = 0;
const LUN = 1;
const MIE = 3;
const SAB = 6;

function fechaCivilLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Próxima fecha `aaaa-mm-dd` (hora local) que cae en el día de la semana pedido,
 * a al menos `minDias` de distancia. Se calcula en el momento para que la prueba
 * no caduque, y el día de la semana se lee del valor que se enviará (UTC).
 */
function proximoDia(diaSemana: number, minDias = 7): string {
  const d = new Date();
  d.setDate(d.getDate() + minDias);
  for (let i = 0; i < 7; i++) {
    const iso = fechaCivilLocal(d);
    if (new Date(`${iso}T00:00:00.000Z`).getUTCDay() === diaSemana) return iso;
    d.setDate(d.getDate() + 1);
  }
  throw new Error(`No se encontró el día ${diaSemana}`);
}

/** Fecha de ayer, para la franja que ya pasó. */
function ayer(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return fechaCivilLocal(d);
}

function textoMensaje(body: unknown): string {
  const m = (body as { message?: unknown }).message;
  if (Array.isArray(m)) return m.join(' | ');
  return typeof m === 'string' ? m : '';
}

describe('Reglas de agenda (horario, descansos y pasado)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let H: Record<string, string>;

  const lunes = proximoDia(LUN);
  const sabado = proximoDia(SAB);
  const domingo = proximoDia(DOM);
  const descanso = proximoDia(MIE);

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);

    prisma = app.get(PrismaService);
    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    // El fixture no trae configuración del consultorio: se le pone un horario real
    // (sin él, `validarHorario` no se ejecuta y el fallo del día queda oculto).
    await prisma.tenantConfig.upsert({
      where: { tenantId: datos.a.tenantId },
      update: { horario: HORARIO, descansos: [] },
      create: {
        tenantId: datos.a.tenantId,
        nombre: 'Clínica A',
        horario: HORARIO,
        descansos: [],
      },
    });

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    H = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) await limpiarDosTenants(prisma);
    if (app) await app.close();
  });

  const agendar = (fecha: string, horaInicio: string, horaFin: string) =>
    request(app.getHttpServer())
      .post('/api/citas')
      .set(H)
      .send({
        pacienteId: datos.a.pacienteId,
        // `sedeId` explícito: el solapamiento se evalúa por sede, y así los casos
        // de esta suite no se estorban entre sí.
        sedeId: datos.a.sedeId,
        fecha,
        horaInicio,
        horaFin,
      });

  it('acepta un lunes dentro del horario', async () => {
    const r = await agendar(lunes, '10:00', '11:00');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // La fecha se guarda como la fecha civil pedida, sin desplazamiento.
    expect((r.body as { fecha: string }).fecha.slice(0, 10)).toBe(lunes);
  });

  it('rechaza el domingo nombrando el día correcto', async () => {
    const r = await agendar(domingo, '10:00', '11:00');
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(textoMensaje(r.body)).toContain('no atiende el día dom');
  });

  it('el sábado aplica SU horario: por la mañana sí, por la tarde no', async () => {
    // Discriminante del fallo de zona horaria: si el sábado se leyera como
    // viernes, la tarde (hasta las 19:00) se aceptaría.
    const manana = await agendar(sabado, '10:00', '11:00');
    expect(manana.status, JSON.stringify(manana.body)).toBe(201);

    const tarde = await agendar(sabado, '15:00', '16:00');
    expect(tarde.status, JSON.stringify(tarde.body)).toBe(400);
    expect(textoMensaje(tarde.body)).toContain('fuera del horario');
  });

  it('rechaza una fecha que cae en un descanso del consultorio', async () => {
    await prisma.tenantConfig.update({
      where: { tenantId: datos.a.tenantId },
      data: { descansos: [{ desde: descanso, hasta: descanso, motivo: 'Feriado de prueba' }] },
    });

    const r = await agendar(descanso, '10:00', '11:00');
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(textoMensaje(r.body)).toContain('descanso');
    expect(textoMensaje(r.body)).toContain('Feriado de prueba');
  });

  it('rechaza agendar en una franja que ya pasó, y lo dice', async () => {
    // Este era el caso reportado: se intentaba agendar para hoy a las 11:00 con la
    // jornada ya terminada, y el mensaje hablaba del horario de atención.
    const r = await agendar(ayer(), '10:00', '11:00');
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    const texto = textoMensaje(r.body);
    expect(texto).toContain('pasado');
    // El mensaje nombra la franja concreta, para que no haya que adivinar.
    expect(texto).toContain(ayer());
    expect(texto).toContain('10:00');
  });

  it('una cita ya pasada SÍ se puede marcar como realizada', async () => {
    // La comprobación de "pasado" solo aplica al MOVER la cita: cerrar el estado
    // de una cita de ayer debe seguir funcionando.
    const pasada = await prisma.cita.create({
      data: {
        tenantId: datos.a.tenantId,
        token: 'CIT-PASADA01',
        pacienteId: datos.a.pacienteId,
        sedeId: datos.a.sedeId,
        fecha: new Date(`${ayer()}T00:00:00.000Z`),
        horaInicio: '08:00',
        horaFin: '08:30',
        estado: 'confirmada',
      },
    });

    await request(app.getHttpServer())
      .patch(`/api/citas/${pasada.id}`)
      .set(H)
      .send({ estado: 'realizada' })
      .expect(200);

    const despues = await prisma.cita.findUniqueOrThrow({ where: { id: pasada.id } });
    expect(despues.estado).toBe('realizada');
  });

  it('rechaza mover una cita a una franja pasada', async () => {
    const futura = await prisma.cita.create({
      data: {
        tenantId: datos.a.tenantId,
        token: 'CIT-MOVER001',
        pacienteId: datos.a.pacienteId,
        sedeId: datos.a.sedeId,
        fecha: new Date(`${lunes}T00:00:00.000Z`),
        horaInicio: '12:00',
        horaFin: '13:00',
        estado: 'pendiente',
      },
    });

    const r = await request(app.getHttpServer())
      .patch(`/api/citas/${futura.id}`)
      .set(H)
      .send({ fecha: ayer() });

    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(textoMensaje(r.body)).toContain('pasado');
  });
});
