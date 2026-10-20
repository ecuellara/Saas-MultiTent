/**
 * Plantillas de notificación (WhatsApp manual, sin API de Meta).
 *
 * Contrato: el listado mezcla el catálogo con la personalización del tenant,
 * la edición es upsert por clave, restaurar vuelve al texto por defecto y
 * nada cruza clínicas. Sin permiso → 403.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { sustituirMarcadores } from '../src/core/catalogo/plantillas.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

describe('Plantillas de WhatsApp', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let datos: DosTenants;
  let HA: Record<string, string>;
  let HB: Record<string, string>;
  /** Usuario sin permisos de agenda: solo sirve para probar el 403. */
  let HS: Record<string, string>;

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

    // Rol sin `appointments.read` ni `appointments.write`: el guard debe cortar
    // aunque el usuario esté autenticado en la clínica.
    const rol = await request(srv)
      .post('/api/roles')
      .set(HA)
      .send({ codigo: 'SIN_NOTIF', nombre: 'Sin notificaciones' })
      .expect(201);
    await request(srv)
      .patch(`/api/roles/${rol.body.id}/permisos`)
      .set(HA)
      .send({ codigos: ['patients.read'] })
      .expect(200);
    await request(srv)
      .post('/api/usuarios')
      .set(HA)
      .send({
        email: 'sin-notif@test.pe',
        password: 'Sin-Notif-2026!',
        nombre: 'Sin notificaciones',
        roleId: rol.body.id,
        sedeId: datos.a.sedeId,
      })
      .expect(201);
    const loginS = await request(srv)
      .post('/api/auth/login')
      .send({ email: 'sin-notif@test.pe', password: 'Sin-Notif-2026!' })
      .expect(200);
    HS = { Authorization: `Bearer ${loginS.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await limpiarDosTenants(prisma);
      // El usuario creado por la API no lleva prefijo del fixture: se borra por
      // email (su Membership cae por CASCADE).
      await prisma.user.deleteMany({ where: { email: 'sin-notif@test.pe' } });
    }
    if (app) await app.close();
  });

  it('lista las 3 claves del catálogo con texto por defecto y marcadores', async () => {
    const r = await request(app.getHttpServer()).get('/api/plantillas-whatsapp').set(HA).expect(200);
    const claves = r.body.plantillas.map((p: { clave: string }) => p.clave).sort();
    expect(claves).toEqual(['cita_cancelacion', 'cita_confirmacion', 'cita_reprogramacion']);
    for (const p of r.body.plantillas) {
      expect(p.esDefecto).toBe(true);
      expect(p.activo).toBe(true);
      expect(p.texto).toContain('{{');
      expect(Array.isArray(p.marcadores)).toBe(true);
    }
    expect(r.body.marcadores.paciente).toBeTruthy();
  });

  it('editar hace upsert y no afecta a la otra clínica', async () => {
    const texto = 'Hola {{paciente}}, cita el {{fecha}} a las {{hora}}.';
    await request(app.getHttpServer())
      .patch('/api/plantillas-whatsapp/cita_confirmacion')
      .set(HA)
      .send({ texto })
      .expect(200)
      .expect((r) => {
        expect(r.body.texto).toBe(texto);
        expect(r.body.esDefecto).toBe(false);
      });
    const otra = await request(app.getHttpServer()).get('/api/plantillas-whatsapp').set(HB).expect(200);
    const confirmacionB = otra.body.plantillas.find(
      (p: { clave: string }) => p.clave === 'cita_confirmacion',
    );
    expect(confirmacionB.esDefecto).toBe(true);
    expect(confirmacionB.texto).not.toBe(texto);
  });

  it('desactivar y restaurar el texto por defecto', async () => {
    await request(app.getHttpServer())
      .patch('/api/plantillas-whatsapp/cita_cancelacion')
      .set(HA)
      .send({ activo: false })
      .expect(200)
      .expect((r) => expect(r.body.activo).toBe(false));
    const r = await request(app.getHttpServer())
      .post('/api/plantillas-whatsapp/cita_cancelacion/restaurar')
      .set(HA)
      .expect(201);
    expect(r.body.texto).toContain('{{paciente}}');
    // Restaurar conserva el estado: seguía desactivada.
    expect(r.body.activo).toBe(false);
  });

  it('clave desconocida → 404 y cuerpo vacío → 400', async () => {
    await request(app.getHttpServer())
      .patch('/api/plantillas-whatsapp/no_existe')
      .set(HA)
      .send({ texto: 'x' })
      .expect(404);
    await request(app.getHttpServer())
      .patch('/api/plantillas-whatsapp/cita_confirmacion')
      .set(HA)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/plantillas-whatsapp/cita_confirmacion')
      .set(HA)
      .send({ texto: '   ' })
      .expect(400);
  });

  it('sin sesión → 401 y sin permiso de agenda → 403', async () => {
    await request(app.getHttpServer()).get('/api/plantillas-whatsapp').expect(401);
    await request(app.getHttpServer()).get('/api/plantillas-whatsapp').set(HS).expect(403);
    await request(app.getHttpServer())
      .patch('/api/plantillas-whatsapp/cita_confirmacion')
      .set(HS)
      .send({ texto: 'no debería guardarse' })
      .expect(403);
  });

  it('la sustitución de marcadores es simple y predecible', () => {
    expect(sustituirMarcadores('Hola {{paciente}}, el {{fecha}}', { paciente: 'Ana Paz' })).toBe(
      'Hola Ana Paz, el {{fecha}}',
    );
    expect(sustituirMarcadores('a {{ x }} b', { paciente: 'Z' })).toBe('a {{ x }} b');
    expect(sustituirMarcadores('{{paciente}}{{paciente}}', { paciente: 'A' })).toBe('AA');
  });
});
