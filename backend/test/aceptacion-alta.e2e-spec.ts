/**
 * Aceptación del alta: el camino REAL del primer cliente, de punta a punta.
 *
 * La clínica actual no tiene datos que migrar (Fase 4 desaparece): el primer
 * cliente nace con `POST /platform/tenants` y empieza de cero. ESTO no lo
 * había probado nadie —`plataforma-tenants` fija el contrato del alta, pero
 * nadie operaba después— así que este spec recorre el primer día completo:
 *  1. Alta por panel (slug y correo propios; limpieza total al terminar).
 *  2. La clínica está lista pero VACÍA: 1 sede, ADMIN con todo el catálogo,
 *     config con nombre y SIN horario, suscripción.
 *  3. Estado de primer arranque: SIN horario la agenda es PERMISIVA (03:00 se
 *     acepta); tras configurar el horario, esa misma cita se rechaza. Y los
 *     catálogos (tratamientos, especialidades, plantillas) están vacíos.
 *  4. El dueño configura y opera: horario, tratamiento, paciente, cita en
 *     horario, pago que cuadra y consentimiento desde plantilla.
 *  5. Aislamiento en ambas direcciones contra las clínicas del fixture.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module.js';
import { CATALOGO_PERMISOS } from '../src/core/catalogo/permisos.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { INestApplication } from '@nestjs/common';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { loginPlataformaConMfa } from './helpers/platform-login.js';
import { fechaFutura } from './helpers/fechas.js';

const SLUG = 'clinica-aceptacion';
const DUENO_EMAIL = 'dueno@aceptacion.pe';
const DUENO_PASSWORD = 'Dueno-Acepta-2026!';
const OWNER_EMAIL = 'owner-aceptacion@test.pe';
const OWNER_PASSWORD = 'Owner-Acepta-2026!';

/** Fecha futura que NO cae en domingo (domingo = cerrado en el horario). */
function proximoLaborable(dias = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function textoMensaje(body: unknown): string {
  const m = (body as { message?: unknown }).message;
  if (Array.isArray(m)) return m.join(' | ');
  return typeof m === 'string' ? m : '';
}

type Db = {
  plan: {
    create: (a: unknown) => Promise<{ id: string }>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  planFeature: { create: (a: unknown) => Promise<unknown> };
  tenant: { deleteMany: (a: unknown) => Promise<unknown> };
  user: { deleteMany: (a: unknown) => Promise<unknown> };
  platformUser: {
    create: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  platformAuditLog: { deleteMany: (a: unknown) => Promise<unknown> };
};

const HORARIO = {
  dom: null,
  lun: { inicio: '08:00', fin: '20:00' },
  mar: { inicio: '08:00', fin: '20:00' },
  mie: { inicio: '08:00', fin: '20:00' },
  jue: { inicio: '08:00', fin: '20:00' },
  vie: { inicio: '08:00', fin: '20:00' },
  sab: { inicio: '08:00', fin: '13:00' },
};

describe('Aceptación del alta: el primer día del primer cliente', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let adminH: Record<string, string>;
  let PH: Record<string, string>;
  /** Cabeceras del dueño en SU clínica (se rellenan tras el alta). */
  let HD: Record<string, string> = {};
  let tenantId = '';
  let sedeId = '';
  let pacienteId = '';
  let tratamientoId = '';

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;
    await limpiarDosTenants(prisma);
    await db.tenant.deleteMany({ where: { slug: SLUG } });
    await db.user.deleteMany({ where: { email: DUENO_EMAIL } });
    await db.plan.deleteMany({ where: { codigo: 'clinica' } });
    await db.platformAuditLog.deleteMany({});
    await db.platformUser.deleteMany({ where: { email: OWNER_EMAIL } });
    datos = await seedDosTenants(prisma);
    const plan = await db.plan.create({
      data: { codigo: 'clinica', nombre: 'Clínica', descripcion: '', precioMensual: 249 },
    });
    await db.planFeature.create({ data: { planId: plan.id, clave: 'multi_sede', habilitado: true, limite: null } });
    await db.planFeature.create({ data: { planId: plan.id, clave: 'max_usuarios', habilitado: true, limite: 20 } });
    await db.platformUser.create({
      data: {
        email: OWNER_EMAIL,
        passwordHash: await bcrypt.hash(OWNER_PASSWORD, 10),
        nombre: 'Owner Aceptación',
        rol: 'owner',
      },
    });
    const sesion = await loginPlataformaConMfa(app.getHttpServer(), OWNER_EMAIL, OWNER_PASSWORD);
    PH = { Authorization: `Bearer ${sesion.access}` };
    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    adminH = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      // El borrado del tenant arrastra TODO lo tenant-scoped en cascada
      // (config, sedes, roles, membresías, pacientes, citas, pagos,
      // consentimientos, suscripción); el dueño (global) y lo de plataforma
      // se borran aparte. Nada de este spec sobrevive a la corrida.
      await db.tenant.deleteMany({ where: { slug: SLUG } });
      await db.user.deleteMany({ where: { email: DUENO_EMAIL } });
      await db.plan.deleteMany({ where: { codigo: 'clinica' } });
      await db.platformAuditLog.deleteMany({});
      await db.platformUser.deleteMany({ where: { email: OWNER_EMAIL } });
      await limpiarDosTenants(prisma);
    }
    if (app) await app.close();
  });

  const http = () => request(app.getHttpServer());

  // ------------------------------------------------------- 1. alta por panel

  it('el dueño de plataforma crea la clínica (sin hashes en la respuesta)', async () => {
    const r = await http()
      .post('/api/platform/tenants')
      .set(PH)
      .send({
        slug: SLUG,
        nombre: 'Clínica Aceptación',
        planCodigo: 'clinica',
        ownerNombre: 'Dueña Aceptación',
        ownerEmail: DUENO_EMAIL,
        ownerPassword: DUENO_PASSWORD,
      })
      .expect(201);
    expect(r.body.slug).toBe(SLUG);
    expect(r.body.owner.email).toBe(DUENO_EMAIL);
    expect(r.body.plan).toBe('clinica');
    const texto = JSON.stringify(r.body);
    expect(texto).not.toContain('passwordHash');
    expect(texto).not.toContain(DUENO_PASSWORD);
    tenantId = String(r.body.id);
    sedeId = String(r.body.sede.id);
  });

  // ------------------------------------------------- 2. lista pero vacía

  it('el dueño entra y su clínica está lista: sede, ADMIN completo, config y suscripción', async () => {
    const login = await http()
      .post('/api/auth/login')
      .send({ email: DUENO_EMAIL, password: DUENO_PASSWORD })
      .expect(200);
    const H = { Authorization: `Bearer ${login.body.access_token}` };
    const sesion = await http().get('/api/auth/sesion').set(H).expect(200);
    const ids = (sesion.body.tenants as Array<{ id: string }>).map((t) => t.id);
    // Una sola clínica: la suya (el aislamiento fino va en el paso 5).
    expect(ids).toEqual([tenantId]);
    HD = { ...H, 'X-Tenant-Id': tenantId };

    const sedes = await http().get('/api/sedes').set(HD).expect(200);
    expect(sedes.body).toHaveLength(1);
    expect(sedes.body[0].nombre).toBe('Sede principal');
    expect(sedes.body[0].esPrincipal).toBe(true);
    expect(sedes.body[0].id).toBe(sedeId);

    const roles = await http().get('/api/roles').set(HD).expect(200);
    const admin = (roles.body as Array<{ codigo: string; permisos: unknown[] }>).find(
      (x) => x.codigo === 'ADMIN',
    );
    expect(admin, 'falta el rol ADMIN del alta').toBeTruthy();
    // Contra el catálogo, no contra un número a mano.
    expect(admin!.permisos).toHaveLength(CATALOGO_PERMISOS.length);

    const config = await http().get('/api/configuracion').set(HD).expect(200);
    expect(config.body.nombre).toBe('Clínica Aceptación');
    // SIN horario: este es el estado de primer arranque del paso 3.
    expect(config.body.horario ?? null).toBeNull();

    const sub = await http().get(`/api/subscriptions/${tenantId}`).set(HD).expect(200);
    expect(sub.body.estado ?? sub.body.data?.estado).toBe('ACTIVE');

    const pacientes = await http().get('/api/pacientes').set(HD).expect(200);
    const cuerpo = Array.isArray(pacientes.body) ? pacientes.body : pacientes.body?.data;
    expect(cuerpo).toHaveLength(0);

    // El alta siembra las plantillas de WhatsApp por defecto (no vacías).
    const wa = await http().get('/api/plantillas-whatsapp').set(HD).expect(200);
    expect(wa.body.plantillas).toHaveLength(3);
    expect(
      wa.body.plantillas.every((p: { activo: boolean; texto: string }) => p.activo && p.texto.includes('{{paciente}}')),
    ).toBe(true);
  });

  // ------------------------------------ 3. primer arranque: agenda permisiva

  it('sin horario la agenda acepta cualquier hora; los catálogos están vacíos', async () => {
    const tratamientos = await http().get('/api/tratamientos').set(HD).expect(200);
    expect(tratamientos.body).toHaveLength(0);
    const especialidades = await http().get('/api/especialidades').set(HD).expect(200);
    expect(especialidades.body).toHaveLength(0);
    const plantillas = await http().get('/api/consentimientos/plantillas').set(HD).expect(200);
    expect(plantillas.body).toHaveLength(0);

    // Hace falta UN paciente para probar la agenda (no es catálogo).
    const pac = await http()
      .post('/api/pacientes')
      .set(HD)
      .send({ tipoDoc: 'DNI', numDoc: '33333333', nombres: 'Primero', apellidos: 'Aceptación' })
      .expect(201);
    pacienteId = String(pac.body.id);

    // Las 03:00 de un día futuro, sin horario configurado: ENTRA. Si alguien
    // "arregla" esto poniendo un horario por defecto en el alta, esta prueba
    // lo caza: el primer arranque documentado es agenda permisiva.
    const madrugada = await http()
      .post('/api/citas')
      .set(HD)
      .send({
        pacienteId,
        sedeId,
        fecha: fechaFutura(30),
        horaInicio: '03:00',
        horaFin: '03:30',
      })
      .expect(201);
    expect(madrugada.body.horaInicio).toBe('03:00');
  });

  it('tras configurar el horario, esa misma cita pasa a rechazarse', async () => {
    await http().patch('/api/configuracion').set(HD).send({ horario: HORARIO }).expect(200);
    const config = await http().get('/api/configuracion').set(HD).expect(200);
    expect(config.body.horario.lun.inicio).toBe('08:00');

    // Otra fecha laborable (para no chocar con la cita ya creada; y fuera de
    // domingo, cuyo mensaje es de día cerrado, no de horario) a la misma hora.
    const r = await http()
      .post('/api/citas')
      .set(HD)
      .send({
        pacienteId,
        sedeId,
        fecha: proximoLaborable(31),
        horaInicio: '03:00',
        horaFin: '03:30',
      });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(textoMensaje(r.body)).toContain('horario');
  });

  // ------------------------------------------------- 4. configura y opera

  it('tratamiento con precio, cita en horario y pago que cuadra', async () => {
    const trat = await http()
      .post('/api/tratamientos')
      .set(HD)
      .send({ nombre: 'Limpieza dental', precio: 120, duracionMin: 30 })
      .expect(201);
    expect(Number(trat.body.precio)).toBe(120);
    tratamientoId = String(trat.body.id);

    const dia = proximoLaborable(30);
    const cita = await http()
      .post('/api/citas')
      .set(HD)
      .send({
        pacienteId,
        tratamientoId,
        sedeId,
        fecha: dia,
        horaInicio: '10:00',
        horaFin: '10:30',
      })
      .expect(201);
    expect(cita.body.fecha.slice(0, 10)).toBe(dia);
    expect(cita.body.horaInicio).toBe('10:00');

    const pago = await http()
      .post('/api/pagos')
      .set(HD)
      .send({
        concepto: 'Limpieza dental',
        tipo: 'ingreso',
        pacienteId,
        montoTotal: 120,
        montoPagado: 120,
      })
      .expect(201);
    // 120 - 120: saldo cero y estado pagado, calculados por el servidor.
    expect(Number(pago.body.saldo)).toBe(0);
    expect(pago.body.estado).toBe('pagado');
  });

  it('consentimiento desde plantilla: borrador con texto congelado', async () => {
    const plantilla = await http()
      .post('/api/consentimientos/plantillas')
      .set(HD)
      .send({ clave: 'limpieza', titulo: 'Consentimiento de limpieza', cuerpo: 'Texto {{paciente}}' })
      .expect(201);
    const cons = await http()
      .post('/api/consentimientos')
      .set(HD)
      .send({
        pacienteId,
        plantillaId: plantilla.body.id,
        datosSnapshot: { paciente: 'Primero Aceptación' },
      })
      .expect(201);
    expect(cons.body.estado).toBe('borrador');
    expect(cons.body.cuerpoSnapshot).toContain('Texto');
  });

  // ------------------------------------------------------- 5. aislamiento

  it('la clínica nueva no ve nada ajeno, y nadie la ve a ella', async () => {
    // Solo su paciente en el listado (el de las 03:00 y el resto son suyos).
    const lista = await http().get('/api/pacientes').set(HD).expect(200);
    const cuerpo = (Array.isArray(lista.body) ? lista.body : lista.body?.data) as Array<{
      id: string;
    }>;
    expect(cuerpo.map((p) => p.id)).toEqual([pacienteId]);

    // El paciente de otra clínica: 404, nunca el dato.
    await http().get(`/api/pacientes/${datos.a.pacienteId}`).set(HD).expect(404);
    await http().get(`/api/pacientes/${datos.b.pacienteId}`).set(HD).expect(404);

    // En la otra dirección: A no ve al paciente nuevo ni al tenant nuevo.
    await http().get(`/api/pacientes/${pacienteId}`).set(adminH).expect(404);
    const sesionA = await http().get('/api/auth/sesion').set(adminH).expect(200);
    const idsA = (sesionA.body.tenants as Array<{ id: string }>).map((t) => t.id);
    expect(idsA).not.toContain(tenantId);
    expect(idsA).toContain(datos.a.tenantId);
  });
});
