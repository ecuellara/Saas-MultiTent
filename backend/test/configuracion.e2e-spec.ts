/**
 * Configuración de la clínica (`GET`/`PATCH /api/configuracion`) y su efecto
 * real en la agenda.
 *
 * Lo que demuestra, en orden:
 *  1. `PATCH` sin `sedes.manage` → 403; con él → 200.
 *  2. `GET` autenticado sin permiso de gestión → 200 (política: el horario y
 *     los datos salen en los documentos de cualquier operador).
 *  3. El horario fijado por API REVIVE las reglas: fuera de horario → 400,
 *     día cerrado → 400, descanso → 400, dentro → 201.
 *  4. Configuración inválida → 400 (claves, horas, rangos, formas).
 *  5. Un `PATCH` sin `ciudad` no la reinicia (default del esquema).
 *  6. Aislamiento: el `PATCH` de A no altera la configuración de B.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import {
  PASSWORD_PLAIN,
  limpiarDosTenants,
  seedDosTenants,
  type DosTenants,
} from './helpers/tenants-fixture.js';
import { montarAppE2E } from './helpers/app.e2e.js';

type Db = {
  user: { deleteMany: (a: unknown) => Promise<unknown> };
};

const EMAIL_RECEP = 'recep-config@test.pe';
const PASS_RECEP = 'Recep-Config-2026!';

/** Próxima fecha civil de ese día de semana (0=dom..6=sab), en UTC, nunca hoy. */
function proximoDia(dia: number): string {
  const hoy = new Date();
  let delta = (dia - hoy.getUTCDay() + 7) % 7;
  if (delta === 0) delta = 7;
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + delta));
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}-${mm}-${dd}`;
}

/** Fecha futura que NO caiga en domingo (para el descanso de prueba). */
function proximoLaborable(): string {
  const hoy = new Date();
  let delta = 30;
  for (;;) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + delta));
    if (d.getUTCDay() !== 0) {
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      return `${d.getUTCFullYear()}-${mm}-${dd}`;
    }
    delta++;
  }
}

const DIA_ABIERTO = { inicio: '08:00', fin: '20:00' };

function horarioBase(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dom: null,
    lun: { ...DIA_ABIERTO },
    mar: { ...DIA_ABIERTO },
    mie: { ...DIA_ABIERTO },
    jue: { ...DIA_ABIERTO },
    vie: { ...DIA_ABIERTO },
    sab: { inicio: '08:00', fin: '13:00' },
    ...extra,
  };
}

describe('Configuración de la clínica', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let adminH: Record<string, string>;
  let recepH: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;

    await limpiarDosTenants(prisma);
    await db.user.deleteMany({ where: { email: EMAIL_RECEP } });
    datos = await seedDosTenants(prisma);

    const srv = app.getHttpServer();
    const loginAdmin = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    adminH = {
      Authorization: `Bearer ${loginAdmin.body.access_token}`,
      'X-Tenant-Id': datos.a.tenantId,
    };

    // Recepción sin `sedes.manage`: puede agendar pero no configurar.
    const rol = await request(srv)
      .post('/api/roles')
      .set(adminH)
      .send({ codigo: 'RECEP_CONFIG', nombre: 'Recepción config' })
      .expect(201);
    await request(srv)
      .patch(`/api/roles/${rol.body.id}/permisos`)
      .set(adminH)
      .send({ codigos: ['patients.read', 'appointments.read', 'appointments.write'] })
      .expect(200);
    await request(srv)
      .post('/api/usuarios')
      .set(adminH)
      .send({
        email: EMAIL_RECEP,
        password: PASS_RECEP,
        nombre: 'Recepción config',
        roleId: rol.body.id,
        sedeId: datos.a.sedeId,
      })
      .expect(201);
    const loginRecep = await request(srv)
      .post('/api/auth/login')
      .send({ email: EMAIL_RECEP, password: PASS_RECEP })
      .expect(200);
    recepH = {
      Authorization: `Bearer ${loginRecep.body.access_token}`,
      'X-Tenant-Id': datos.a.tenantId,
    };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      // El borrado del tenant arrastra membresías, roles y permisos; el
      // usuario (global) se borra aparte.
      await db.user.deleteMany({ where: { email: EMAIL_RECEP } });
      await limpiarDosTenants(prisma);
    }
    if (app) await app.close();
  });

  it('1. PATCH sin sedes.manage → 403; con él → 200', async () => {
    const srv = app.getHttpServer();
    await request(srv).patch('/api/configuracion').set(recepH).send({ nombre: 'X' }).expect(403);
    await request(srv).patch('/api/configuracion').set(adminH).send({ nombre: 'Clínica A' }).expect(200);
  });

  it('2. GET autenticado sin permiso de gestión → 200', async () => {
    const srv = app.getHttpServer();
    const r = await request(srv).get('/api/configuracion').set(recepH).expect(200);
    expect(r.body.tenantId ?? r.body.data?.tenantId).toBe(datos.a.tenantId);
  });

  it('3. el horario fijado por API revive las reglas de la agenda', async () => {
    const srv = app.getHttpServer();
    const descanso = proximoLaborable();
    await request(srv)
      .patch('/api/configuracion')
      .set(adminH)
      .send({ horario: horarioBase(), descansos: [{ desde: descanso, motivo: 'Prueba' }] })
      .expect(200);

    const cita = (fecha: string, horaInicio: string, horaFin: string) =>
      request(srv).post('/api/citas').set(adminH).send({
        pacienteId: datos.a.pacienteId,
        fecha,
        horaInicio,
        horaFin,
      });

    // Sábado 14:00, fuera de su franja 08:00-13:00 → 400.
    await cita(proximoDia(6), '14:00', '14:30').expect(400);
    // Domingo (cerrado) → 400.
    await cita(proximoDia(0), '10:00', '10:30').expect(400);
    // Fecha de descanso (laborable, dentro de horario) → 400.
    await cita(descanso, '10:00', '10:30').expect(400);
    // Sábado 10:00, dentro de su franja → 201.
    await cita(proximoDia(6), '10:00', '10:30').expect(201);
    // Lunes 10:00, dentro del horario → 201.
    const ok = await cita(proximoDia(1), '10:00', '10:30').expect(201);
    expect(ok.body.id ?? ok.body.data?.id).toBeTruthy();

    // Día OMITIDO equivale a cerrado (el lector trata igual `undefined` y
    // `null`): se guarda con 200 y el miércoles no atiende. Lo que NUNCA pasa
    // en silencio es una clave mal escrita (`mier` → 400 por whitelist).
    const sinMie = horarioBase() as Record<string, unknown>;
    delete sinMie.mie;
    await request(srv).patch('/api/configuracion').set(adminH).send({ horario: sinMie }).expect(200);
    await cita(proximoDia(3), '10:00', '10:30').expect(400);
  });

  it('4. configuración inválida → 400', async () => {
    const srv = app.getHttpServer();
    const base = () => ({ horario: horarioBase() });
    const casos: Array<[string, Record<string, unknown>]> = [
      ['clave de día desconocida', { horario: { ...horarioBase(), mier: { inicio: '08:00', fin: '12:00' } } }],
      ['hora sin cero delante', { horario: horarioBase({ lun: { inicio: '9:00', fin: '19:00' } }) }],
      ['hora imposible', { horario: horarioBase({ lun: { inicio: '08:00', fin: '25:00' } }) }],
      ['inicio >= fin', { horario: horarioBase({ lun: { inicio: '10:00', fin: '09:00' } }) }],
      ['inicio == fin', { horario: horarioBase({ lun: { inicio: '10:00', fin: '10:00' } }) }],
      ['horario como array', { horario: [] }],
      ['horario como texto', { horario: 'siempre' }],
      ['descanso con fecha imposible', { ...base(), descansos: [{ desde: '2026-13-01' }] }],
      ['descanso hasta < desde', { ...base(), descansos: [{ desde: '2030-05-10', hasta: '2030-05-01' }] }],
      ['descanso hasta mal formado', { ...base(), descansos: [{ desde: '2030-05-10', hasta: '10/05/2030' }] }],
      ['tenantId en el cuerpo', { ...base(), tenantId: datos.b.tenantId }],
    ];
    for (const [nombre, cuerpo] of casos) {
      const r = await request(srv).patch('/api/configuracion').set(adminH).send(cuerpo);
      expect(r.status, `caso «${nombre}»`).toBe(400);
    }
  });

  it('5. un PATCH sin ciudad no la reinicia', async () => {
    const srv = app.getHttpServer();
    await request(srv)
      .patch('/api/configuracion')
      .set(adminH)
      .send({ ciudad: 'Lima', nombre: 'Clínica A' })
      .expect(200);
    const r = await request(srv)
      .patch('/api/configuracion')
      .set(adminH)
      .send({ nombre: 'Clínica A renombrada' })
      .expect(200);
    expect(r.body.ciudad ?? r.body.data?.ciudad).toBe('Lima');
  });

  it('6. el PATCH de A no altera la configuración de B', async () => {
    const srv = app.getHttpServer();
    const adminB = await loginComo(datos.b.userEmail);
    const horarioA = horarioBase({ lun: { inicio: '09:00', fin: '12:00' } });
    const horarioB = horarioBase({ lun: { inicio: '14:00', fin: '18:00' } });
    await request(srv).patch('/api/configuracion').set(adminH).send({ horario: horarioA }).expect(200);
    await request(srv).patch('/api/configuracion').set(adminB).send({ horario: horarioB }).expect(200);

    const [ra, rb] = await Promise.all([
      request(srv).get('/api/configuracion').set(adminH).expect(200),
      request(srv).get('/api/configuracion').set(adminB).expect(200),
    ]);
    const ha = (ra.body.horario ?? ra.body.data?.horario) as Record<string, { inicio: string }>;
    const hb = (rb.body.horario ?? rb.body.data?.horario) as Record<string, { inicio: string }>;
    expect(ha.lun?.inicio).toBe('09:00');
    expect(hb.lun?.inicio).toBe('14:00');
  });

  async function loginComo(email: string): Promise<Record<string, string>> {
    const r = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD_PLAIN })
      .expect(200);
    const tenantId = email === datos.b.userEmail ? datos.b.tenantId : datos.a.tenantId;
    return { Authorization: `Bearer ${r.body.access_token}`, 'X-Tenant-Id': tenantId };
  }
});
