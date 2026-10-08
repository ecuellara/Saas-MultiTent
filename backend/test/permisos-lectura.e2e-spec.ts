/**
 * Permisos de lectura clínica.
 *
 * Antes ningún GET exigía `patients.read`, así que un rol acotado (p. ej.
 * recepción sin acceso a historia clínica) leía expedientes completos con solo
 * estar autenticado. Este spec fija el contrato: sin el permiso → 403.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

type Db = {
  user: { deleteMany: (a: unknown) => Promise<unknown> };
  plan: {
    create: (a: unknown) => Promise<{ id: string }>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
  planFeature: { create: (a: unknown) => Promise<unknown> };
  subscription: {
    create: (a: unknown) => Promise<unknown>;
    deleteMany: (a: unknown) => Promise<unknown>;
  };
};

describe('Permisos de lectura clínica', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let adminH: Record<string, string>;
  let sinClinicaH: Record<string, string>;
  /** Id del usuario acotado (para probar que ni a sí mismo se lee sin permiso). */
  let sinClinicaUserId = '';

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;

    await limpiarDosTenants(prisma);
    await db.user.deleteMany({ where: { email: 'sin-clinica@test.pe' } });
    datos = await seedDosTenants(prisma);

    // Suscripciones reales en A y B: el 404 de lectura cruzada debe darse con
    // la fila existiendo (si no existiera, el 404 no probaría aislamiento).
    const plan = await db.plan.create({
      data: { codigo: 'perm-lectura', nombre: 'Plan de pruebas de lectura', precioMensual: 10 },
    });
    for (const tenantId of [datos.a.tenantId, datos.b.tenantId]) {
      await db.subscription.create({
        data: {
          tenantId,
          planId: plan.id,
          estado: 'ACTIVE',
          periodoInicio: new Date('2026-01-01T00:00:00.000Z'),
          periodoFin: new Date('2027-01-01T00:00:00.000Z'),
        },
      });
    }

    const srv = app.getHttpServer();
    const loginAdmin = await request(srv)
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    adminH = {
      Authorization: `Bearer ${loginAdmin.body.access_token}`,
      'X-Tenant-Id': datos.a.tenantId,
    };

    // Rol con permiso para AGENDAR pero sin acceso a la información clínica:
    // es el caso real de una recepción acotada.
    const rol = await request(srv)
      .post('/api/roles')
      .set(adminH)
      .send({ codigo: 'SIN_CLINICA', nombre: 'Sin acceso clínico' })
      .expect(201);
    await request(srv)
      .patch(`/api/roles/${rol.body.id}/permisos`)
      .set(adminH)
      .send({ codigos: ['appointments.read', 'appointments.write'] })
      .expect(200);
    await request(srv)
      .post('/api/usuarios')
      .set(adminH)
      .send({
        email: 'sin-clinica@test.pe',
        password: 'Sin-Clinica-2026!',
        nombre: 'Recepción acotada',
        roleId: rol.body.id,
        sedeId: datos.a.sedeId,
      })
      .expect(201)
      .expect((r) => {
        sinClinicaUserId = String(r.body?.id ?? r.body?.data?.id ?? '');
        expect(sinClinicaUserId.length).toBeGreaterThan(0);
      });

    const loginAcotado = await request(srv)
      .post('/api/auth/login')
      .send({ email: 'sin-clinica@test.pe', password: 'Sin-Clinica-2026!' })
      .expect(200);
    sinClinicaH = {
      Authorization: `Bearer ${loginAcotado.body.access_token}`,
      'X-Tenant-Id': datos.a.tenantId,
    };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await limpiarDosTenants(prisma);
      await db.user.deleteMany({ where: { email: 'sin-clinica@test.pe' } });
      if (datos) {
        await db.subscription.deleteMany({ where: { tenantId: { in: [datos.a.tenantId, datos.b.tenantId] } } });
      }
      await db.plan.deleteMany({ where: { codigo: 'perm-lectura' } });
    }
    if (app) await app.close();
  });

  // Rutas que exponen información clínica del paciente.
  const rutasClinicas: Array<{ nombre: string; path: (d: DosTenants) => string }> = [
    { nombre: 'listado de pacientes', path: () => '/api/pacientes' },
    { nombre: 'ficha del paciente', path: (d) => `/api/pacientes/${d.a.pacienteId}` },
    { nombre: 'historiales', path: (d) => `/api/pacientes/${d.a.pacienteId}/historiales` },
    { nombre: 'documentos', path: (d) => `/api/pacientes/${d.a.pacienteId}/documentos` },
    {
      nombre: 'descarga de documento',
      path: (d) => `/api/pacientes/${d.a.pacienteId}/documentos/${d.a.documentoId}/descarga`,
    },
    { nombre: 'odontogramas del paciente', path: (d) => `/api/pacientes/${d.a.pacienteId}/odontogramas` },
    { nombre: 'odontograma por id', path: (d) => `/api/odontogramas/${d.a.odontogramaId}` },
    { nombre: 'consentimiento por id', path: (d) => `/api/consentimientos/${d.a.consentimientoId}` },
    { nombre: 'plantillas de consentimiento', path: () => '/api/consentimientos/plantillas' },
    { nombre: 'historiales (controlador propio)', path: (d) => `/api/historiales?pacienteId=${d.a.pacienteId}` },
  ];

  it.each(rutasClinicas)('sin el permiso, $nombre responde 403', async ({ path }) => {
    await request(app.getHttpServer()).get(path(datos)).set(sinClinicaH).expect(403);
  });

  it('el permiso de agenda SÍ permite leer citas (no se exige patients.read para eso)', async () => {
    await request(app.getHttpServer()).get('/api/citas').set(sinClinicaH).expect(200);
  });

  // Rutas FINANCIERAS. Son las últimas lecturas que quedaban sin permiso: un rol
  // con solo agenda podía pedir la lista completa de cobros (importes incluidos)
  // por API aunque la interfaz no le mostrara el módulo.
  const rutasFinancieras: Array<{ nombre: string; path: (d: DosTenants) => string }> = [
    { nombre: 'listado de pagos', path: () => '/api/pagos' },
    { nombre: 'detalle de pago', path: (d) => `/api/pagos/${d.a.pagoId}` },
  ];

  it.each(rutasFinancieras)('sin payments.read, $nombre responde 403', async ({ path }) => {
    await request(app.getHttpServer()).get(path(datos)).set(sinClinicaH).expect(403);
  });

  it('control: el administrador (con payments.read) sí lee los pagos', async () => {
    await request(app.getHttpServer()).get('/api/pagos').set(adminH).expect(200);
  });

  it('control: el administrador (con patients.read) sí lee la ficha', async () => {
    const r = await request(app.getHttpServer())
      .get(`/api/pacientes/${datos.a.pacienteId}`)
      .set(adminH)
      .expect(200);
    expect(r.body.id ?? r.body.data?.id).toBe(datos.a.pacienteId);
  });

  // Rutas de INVENTARIO. Mismo fallo que las financieras: stock, precios de
  // proveedor e importes de compra visibles con solo estar autenticado.
  const rutasInventario: Array<{ nombre: string; path: (d: DosTenants) => string }> = [
    { nombre: 'listado de insumos', path: () => '/api/insumos' },
    { nombre: 'insumo por id', path: (d) => `/api/insumos/${d.a.insumoId}` },
    { nombre: 'listado de proveedores', path: () => '/api/proveedores' },
    { nombre: 'proveedor por id', path: (d) => `/api/proveedores/${d.a.proveedorId}` },
    { nombre: 'listado de compras', path: () => '/api/compras' },
    { nombre: 'compra por id', path: (d) => `/api/compras/${d.a.compraId}` },
  ];

  it.each(rutasInventario)('sin inventory.read, $nombre responde 403', async ({ path }) => {
    await request(app.getHttpServer()).get(path(datos)).set(sinClinicaH).expect(403);
  });

  it('control: el administrador (con inventory.read) sí lee el inventario', async () => {
    const r = await request(app.getHttpServer()).get('/api/insumos').set(adminH).expect(200);
    const lista = r.body?.data ?? r.body;
    expect(Array.isArray(lista)).toBe(true);
    expect(lista.map((i: { id: string }) => i.id)).toContain(datos.a.insumoId);
  });

  // Lectura de USUARIOS. Sin `users.manage` ni siquiera uno puede leerse a sí
  // mismo: la ficha incluye email, sede y rol (útil para enumerar el equipo).
  it('sin users.manage, leer el propio usuario responde 403', async () => {
    await request(app.getHttpServer()).get(`/api/usuarios/${sinClinicaUserId}`).set(sinClinicaH).expect(403);
  });

  it('control: el administrador (con users.manage) sí lee usuarios de su clínica', async () => {
    await request(app.getHttpServer()).get(`/api/usuarios/${datos.a.userId}`).set(adminH).expect(200);
  });

  // Lectura de SUSCRIPCIÓN. Es información de facturación (plan, periodos):
  // exige `payments.read` y, con permiso, el aislamiento lo da el servicio.
  it('sin payments.read, leer la suscripción propia responde 403', async () => {
    await request(app.getHttpServer()).get(`/api/subscriptions/${datos.a.tenantId}`).set(sinClinicaH).expect(403);
  });

  it('con payments.read, la suscripción ajena responde 404 aunque exista', async () => {
    // La suscripción de B existe (creada en el setup): el 404 no es por
    // ausencia sino porque el servicio no cruza clínicas.
    await request(app.getHttpServer()).get(`/api/subscriptions/${datos.b.tenantId}`).set(adminH).expect(404);
  });

  it('control: el administrador (con payments.read) sí lee su suscripción', async () => {
    await request(app.getHttpServer()).get(`/api/subscriptions/${datos.a.tenantId}`).set(adminH).expect(200);
  });
});
