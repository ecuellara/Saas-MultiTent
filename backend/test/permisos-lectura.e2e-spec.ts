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
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

type Db = {
  user: { deleteMany: (a: unknown) => Promise<unknown> };
};

describe('Permisos de lectura clínica', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let adminH: Record<string, string>;
  let sinClinicaH: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;

    await limpiarDosTenants(prisma);
    await db.user.deleteMany({ where: { email: 'sin-clinica@test.pe' } });
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
      .expect(201);

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

  it('control: el administrador (con patients.read) sí lee la ficha', async () => {
    const r = await request(app.getHttpServer())
      .get(`/api/pacientes/${datos.a.pacienteId}`)
      .set(adminH)
      .expect(200);
    expect(r.body.id ?? r.body.data?.id).toBe(datos.a.pacienteId);
  });
});
