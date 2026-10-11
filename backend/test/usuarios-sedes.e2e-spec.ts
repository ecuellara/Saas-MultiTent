/**
 * Equipo, roles y sedes: lo que necesitaban `/usuarios` y `/sedes`.
 *
 * Cubre los tres huecos:
 *  1. `GET /api/usuarios`: equipo con rol y sede (con nombre), 403 sin
 *     `users.manage`, aislamiento entre clínicas y NINGÚN secreto en el JSON
 *     (`passwordHash`, `passwordAlgo`, `mfaSecret`).
 *  2. `GET /api/roles/permisos`: el catálogo desde la fuente única (sin
 *     duplicar la lista), 403 sin `roles.manage` y `:id` sin capturarlo.
 *     `PATCH /roles/:id/permisos` con un código inexistente → 400.
 *  3. `PATCH /api/sedes/:id`: parcial sin borrar lo no enviado, 403 sin
 *     `sedes.manage` y 404 para la sede de otra clínica.
 *
 * NOTA: el enunciado habla de 15 permisos, pero `CATALOGO_PERMISOS` tiene 16
 * (se cuenta en el informe, no se ajusta la prueba: se compara contra la
 * fuente, no contra un número escrito a mano).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { CATALOGO_PERMISOS } from '../src/core/catalogo/permisos.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

const EMAIL_ACOTADO = 'sin-gestion@test.pe';
const EMAIL_NUEVO = 'nuevo-equipo@test.pe';

type Membresia = {
  role: { id: string; codigo: string; nombre: string };
  sede: { id: string; nombre: string } | null;
};
type UsuarioEquipo = {
  id: string;
  email: string;
  nombre: string;
  estado: string;
  memberships: Membresia[];
};

type Db = {
  user: { deleteMany: (a: unknown) => Promise<unknown> };
};

describe('Usuarios, roles y sedes', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let datos: DosTenants;
  let H: Record<string, string>;
  let HB: Record<string, string>;
  /** Sin ningún permiso de gestión: solo agenda. */
  let C: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;

    await limpiarDosTenants(prisma);
    // `User` es global (sin tenant): los creados por este spec sobrevivirían
    // a la limpieza por prefijo y romperían la siguiente corrida con
    // «Email ya registrado». Se borran antes y después, como en
    // permisos-lectura con `sin-clinica@test.pe`.
    await db.user.deleteMany({ where: { email: { in: [EMAIL_ACOTADO, EMAIL_NUEVO] } } });
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

    const rol = await request(srv)
      .post('/api/roles')
      .set(H)
      .send({ codigo: 'SIN_GESTION', nombre: 'Sin gestión' })
      .expect(201);
    await request(srv)
      .patch(`/api/roles/${rol.body.id}/permisos`)
      .set(H)
      .send({ codigos: ['appointments.read', 'appointments.write'] })
      .expect(200);
    await request(srv)
      .post('/api/usuarios')
      .set(H)
      .send({
        email: EMAIL_ACOTADO,
        password: 'Sin-Gestion-2026!',
        nombre: 'Sin gestión',
        roleId: rol.body.id,
        sedeId: datos.a.sedeId,
      })
      .expect(201);
    const loginC = await request(srv)
      .post('/api/auth/login')
      .send({ email: EMAIL_ACOTADO, password: 'Sin-Gestion-2026!' })
      .expect(200);
    C = { Authorization: `Bearer ${loginC.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      await db.user.deleteMany({ where: { email: { in: [EMAIL_ACOTADO, EMAIL_NUEVO] } } });
      await limpiarDosTenants(prisma);
    }
    if (app) await app.close();
  });

  const http = () => request(app.getHttpServer());

  // ---------------------------------------------------------------- usuarios

  it('GET /usuarios lista el equipo con rol y sede, sin secretos', async () => {
    const r = await http().get('/api/usuarios').set(H).expect(200);
    expect(Array.isArray(r.body)).toBe(true);
    const lista = r.body as UsuarioEquipo[];
    const admin = lista.find((u) => u.id === datos.a.userId);
    expect(admin, 'el admin de A no está en su propio equipo').toBeTruthy();
    expect(admin!.email).toBe(datos.a.userEmail);
    expect(admin!.memberships[0]?.role.nombre).toBe('Administrador');
    expect(admin!.memberships[0]?.sede?.nombre).toBe('Sede principal');
    expect(admin!.estado).toBe('ACTIVE');

    // Invariante 3 sobre el JSON completo, no solo sobre un campo: si un
    // secreto se colara en CUALQUIER usuario o membresía, esto lo caza.
    const texto = JSON.stringify(r.body);
    expect(texto).not.toContain('passwordHash');
    expect(texto).not.toContain('passwordAlgo');
    expect(texto).not.toContain('mfaSecret');
  });

  it('sin users.manage, el listado responde 403', async () => {
    await http().get('/api/usuarios').set(C).expect(403);
  });

  it('aislamiento: los usuarios de B no aparecen desde A', async () => {
    const r = await http().get('/api/usuarios').set(H).expect(200);
    const lista = r.body as UsuarioEquipo[];
    expect(lista.map((u) => u.id)).not.toContain(datos.b.userId);
    expect(lista.map((u) => u.email)).not.toContain(datos.b.userEmail);

    const rB = await http().get('/api/usuarios').set(HB).expect(200);
    expect((rB.body as UsuarioEquipo[]).map((u) => u.id)).not.toContain(datos.a.userId);
  });

  it('el alta no devuelve el hash (ni secretos)', async () => {
    const r = await http()
      .post('/api/usuarios')
      .set(H)
      .send({
        email: EMAIL_NUEVO,
        password: 'Nuevo-Equipo-2026!',
        nombre: 'Nuevo Equipo',
        roleId: datos.a.roleId,
        sedeId: datos.a.sedeId,
      })
      .expect(201);
    const texto = JSON.stringify(r.body);
    expect(texto).not.toContain('passwordHash');
    expect(texto).not.toContain('passwordAlgo');
    expect(texto).not.toContain('mfaSecret');
    expect(texto).not.toContain('Nuevo-Equipo-2026!');
  });

  // ------------------------------------------------------------------- roles

  it('GET /roles/permisos devuelve el catálogo (y `:id` no lo captura)', async () => {
    const r = await http().get('/api/roles/permisos').set(H).expect(200);
    // Si `:id` capturara `permisos`, esto sería un 404 o un rol.
    expect(Array.isArray(r.body)).toBe(true);
    const lista = r.body as Array<Record<string, unknown>>;
    expect(lista).toHaveLength(CATALOGO_PERMISOS.length);
    for (const p of lista) expect(Object.keys(p).sort()).toEqual(['accion', 'codigo', 'recurso']);
    expect(lista.find((p) => p.codigo === 'patients.read')).toEqual({
      codigo: 'patients.read',
      recurso: 'patients',
      accion: 'read',
    });
    // Sin duplicar la lista: todo lo servido está en la fuente única.
    const fuente = new Set(CATALOGO_PERMISOS.map((p) => p.codigo));
    for (const p of lista) expect(fuente.has(String(p.codigo))).toBe(true);
  });

  it('sin roles.manage, el catálogo responde 403', async () => {
    await http().get('/api/roles/permisos').set(C).expect(403);
  });

  it('PATCH /roles/:id/permisos con un código inexistente → 400', async () => {
    const rol = await http()
      .post('/api/roles')
      .set(H)
      .send({ codigo: 'PARA_400', nombre: 'Para 400' })
      .expect(201);
    await http()
      .patch(`/api/roles/${rol.body.id}/permisos`)
      .set(H)
      .send({ codigos: ['patients.read', 'permiso-que-no-existe'] })
      .expect(400);
    // El rol sigue intacto (sin permisos a medias).
    const luego = await http().get(`/api/roles/${rol.body.id}`).set(H).expect(200);
    expect(luego.body.permisos).toEqual([]);
  });

  // ------------------------------------------------------------------- sedes

  it('PATCH /sedes/:id parcial no borra lo que no se envía', async () => {
    const antes = await http().get(`/api/sedes/${datos.a.sedeId}`).set(H).expect(200);
    expect(antes.body.nombre).toBe('Sede principal');

    const r = await http()
      .patch(`/api/sedes/${datos.a.sedeId}`)
      .set(H)
      .send({ telefono: '999888777' })
      .expect(200);
    expect(r.body.telefono).toBe('999888777');
    expect(r.body.nombre).toBe(antes.body.nombre);
    expect(r.body.direccion).toBe(antes.body.direccion);

    const off = await http()
      .patch(`/api/sedes/${datos.a.sedeId}`)
      .set(H)
      .send({ activo: false })
      .expect(200);
    expect(off.body.activo).toBe(false);
    const on = await http()
      .patch(`/api/sedes/${datos.a.sedeId}`)
      .set(H)
      .send({ activo: true })
      .expect(200);
    expect(on.body.activo).toBe(true);
  });

  it('sin sedes.manage, editar responde 403', async () => {
    await http().patch(`/api/sedes/${datos.a.sedeId}`).set(C).send({ telefono: '000' }).expect(403);
  });

  it('la sede de otra clínica responde 404 aunque exista', async () => {
    // La sede de B existe (la creó el fixture): el 404 es aislamiento, no
    // ausencia. Y B sigue intacta después del intento.
    await http().patch(`/api/sedes/${datos.b.sedeId}`).set(H).send({ telefono: '000' }).expect(404);
    const intacta = await http().get(`/api/sedes/${datos.b.sedeId}`).set(HB).expect(200);
    expect(intacta.body.telefono).not.toBe('000');
  });
});
