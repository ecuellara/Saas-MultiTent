/**
 * Firmas de consentimientos informados (multipart + magic bytes).
 *
 * Lo que demuestra, y por qué importa:
 *  1. `cuerpoSnapshot` CONGELADO: se cambia la plantilla después de crear y el
 *     consentimiento conserva el texto viejo (sin esto, «congelar» es solo una
 *     afirmación y el PDF podría diferir de lo que el paciente vio).
 *  2. PNG real → 201; archivo falso con nombre `.png` → 400 (lo caza el
 *     sniffing, no la extensión); por encima del tope → 413 (multer, igual que
 *     documentos); sin archivo o rol inválido → 400.
 *  3. Adjuntar a `firmado`/`revocado`/`anulado` → 400 (documento legal
 *     inmutable, igual que el odontograma firmado).
 *  4. Transiciones: válidas 200 (firmar EXIGE firma del paciente: 400 sin
 *     ella); inválidas (`anulado→firmado`, `firmado→borrador`) → 400.
 *  5. Descarga con `consents.read` → 200 y bytes idénticos; sin permiso → 403;
 *     de otra clínica → 404. El JSON nunca lleva claves de almacenamiento.
 *  6. Aislamiento: lo de A no se lee ni se firma desde B, y viceversa.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'node:fs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { montarAppE2E } from './helpers/app.e2e.js';
import { FALSO_PNG, PNG_BYTES, binario, pngGigante } from './helpers/archivos.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { StorageService } from '../src/core/storage/storage.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

type Db = {
  consentimientoPlantilla: {
    findFirst: (a: unknown) => Promise<{ id: string } | null>;
    update: (a: unknown) => Promise<unknown>;
  };
  consentimientoFirmado: {
    findUnique: (a: unknown) => Promise<Record<string, unknown> | null>;
    findMany: (a: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  user: { deleteMany: (a: unknown) => Promise<unknown> };
};

const EMAIL_ACOTADO = 'recep-firma@test.pe';

describe('Firmas de consentimientos', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let storage: StorageService;
  let datos: DosTenants;
  let adminH: Record<string, string>;
  let adminBH: Record<string, string>;
  let acotadoH: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await montarAppE2E(modulo);
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;
    storage = app.get(StorageService);

    await limpiarDosTenants(prisma);
    await db.user.deleteMany({ where: { email: EMAIL_ACOTADO } });
    datos = await seedDosTenants(prisma);

    const srv = app.getHttpServer();
    const login = async (email: string, password: string, tenantId: string) => {
      const r = await request(srv).post('/api/auth/login').send({ email, password }).expect(200);
      return { Authorization: `Bearer ${r.body.access_token}`, 'X-Tenant-Id': tenantId } as Record<string, string>;
    };
    adminH = await login(datos.a.userEmail, PASSWORD_PLAIN, datos.a.tenantId);
    adminBH = await login(datos.b.userEmail, PASSWORD_PLAIN, datos.b.tenantId);

    // Usuario acotado SIN `consents.read` ni `consents.write`.
    const rol = await request(srv)
      .post('/api/roles')
      .set(adminH)
      .send({ codigo: 'RECEP_FIRMA', nombre: 'Recepción sin consentimientos' })
      .expect(201);
    await request(srv)
      .patch(`/api/roles/${rol.body.id}/permisos`)
      .set(adminH)
      .send({ codigos: ['patients.read'] })
      .expect(200);
    await request(srv)
      .post('/api/usuarios')
      .set(adminH)
      .send({
        email: EMAIL_ACOTADO,
        password: 'Recep-Firma-2026!',
        nombre: 'Recepción acotada',
        roleId: rol.body.id,
        sedeId: datos.a.sedeId,
      })
      .expect(201);
    const loginAcotado = await request(srv)
      .post('/api/auth/login')
      .send({ email: EMAIL_ACOTADO, password: 'Recep-Firma-2026!' })
      .expect(200);
    acotadoH = {
      Authorization: `Bearer ${loginAcotado.body.access_token}`,
      'X-Tenant-Id': datos.a.tenantId,
    };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      // Primero los ARCHIVOS (las filas aún referencian las claves) y luego
      // los tenants (cascada que borra las filas).
      const filas = await db.consentimientoFirmado.findMany({ where: { tenantId: datos.a.tenantId } });
      for (const f of filas) {
        for (const k of [f.firmaPacienteKey, f.firmaOdontologoKey]) {
          if (typeof k === 'string') {
            try {
              await fs.promises.rm(storage.rutaLocal(k), { force: true });
            } catch {
              // La limpieza no debe enmascarar el resultado de las pruebas.
            }
          }
        }
      }
      await db.user.deleteMany({ where: { email: EMAIL_ACOTADO } });
      await limpiarDosTenants(prisma);
    }
    if (app) await app.close();
  });

  async function crearBorrador(): Promise<string> {
    const plantilla = await db.consentimientoPlantilla.findFirst({
      where: { tenantId: datos.a.tenantId, clave: 'endodoncia' },
    });
    const r = await request(app.getHttpServer())
      .post('/api/consentimientos')
      .set(adminH)
      .send({ pacienteId: datos.a.pacienteId, plantillaId: plantilla!.id, datosSnapshot: { ok: true } })
      .expect(201);
    return String((r.body as { id: string }).id);
  }

  const firmar = (id: string, rol = 'paciente', archivo: Buffer = PNG_BYTES, nombre = 'firma.png') =>
    request(app.getHttpServer())
      .post(`/api/consentimientos/${id}/firmas`)
      .set(adminH)
      .field('rol', rol)
      .attach('archivo', archivo, { filename: nombre, contentType: 'image/png' });

  it('1. el cuerpoSnapshot se congela al crear (no sigue a la plantilla)', async () => {
    const plantilla = await db.consentimientoPlantilla.findFirst({
      where: { tenantId: datos.a.tenantId, clave: 'endodoncia' },
    });
    if (!plantilla) throw new Error('sin plantilla endodoncia en el fixture');
    const c1 = await request(app.getHttpServer())
      .post('/api/consentimientos')
      .set(adminH)
      .send({ pacienteId: datos.a.pacienteId, plantillaId: plantilla.id, datosSnapshot: { ok: 1 } })
      .expect(201);
    expect((c1.body as { cuerpoSnapshot: string }).cuerpoSnapshot).toContain('Texto');

    await db.consentimientoPlantilla.update({
      where: { id: plantilla.id },
      data: { cuerpo: 'TEXTO NUEVO QUE EL PACIENTE NUNCA VIO' },
    });

    const g1 = await request(app.getHttpServer()).get(`/api/consentimientos/${c1.body.id}`).set(adminH).expect(200);
    expect((g1.body as { cuerpoSnapshot: string }).cuerpoSnapshot).not.toContain('TEXTO NUEVO');
    expect((g1.body as { cuerpoSnapshot: string }).cuerpoSnapshot).toContain('Texto');

    // Y lo creado DESPUÉS sí congela el texto nuevo (no es lectura rancia).
    const c2 = await request(app.getHttpServer())
      .post('/api/consentimientos')
      .set(adminH)
      .send({ pacienteId: datos.a.pacienteId, plantillaId: plantilla.id, datosSnapshot: { ok: 2 } })
      .expect(201);
    expect((c2.body as { cuerpoSnapshot: string }).cuerpoSnapshot).toContain('TEXTO NUEVO');
  });

  it('2. PNG real → 201; falso, gigante, sin archivo o rol inválido → 400/413', async () => {
    const id = await crearBorrador();
    const r = await firmar(id).expect(201);
    // La respuesta no lleva claves de almacenamiento.
    expect((r.body as Record<string, unknown>).firmaPacienteKey).toBeUndefined();
    expect((r.body as Record<string, unknown>).pdfKey).toBeUndefined();
    expect((r.body as Record<string, unknown>).storageKey).toBeUndefined();

    // La fila SÍ guarda la clave, bajo el tenant y sin exponerla.
    const fila = await db.consentimientoFirmado.findUnique({ where: { id } });
    const clave = fila!.firmaPacienteKey as string;
    expect(clave.startsWith(`tenants/${datos.a.tenantId}/`)).toBe(true);
    expect(fs.existsSync(storage.rutaLocal(clave))).toBe(true);

    const id2 = await crearBorrador();
    await firmar(id2, 'paciente', FALSO_PNG, 'falso.png').expect(400);
    const intacta = await db.consentimientoFirmado.findUnique({ where: { id: id2 } });
    expect(intacta!.firmaPacienteKey).toBeNull();

    await firmar(id2, 'paciente', pngGigante(), 'enorme.png').expect(413);
    await request(app.getHttpServer())
      .post(`/api/consentimientos/${id2}/firmas`)
      .set(adminH)
      .field('rol', 'paciente')
      .expect(400);
    await firmar(id2, 'tutor', PNG_BYTES).expect(400);
  });

  it('3. adjuntar a firmado/revocado/anulado → 400', async () => {
    const srv = app.getHttpServer();
    const firmado = await crearBorrador();
    await firmar(firmado).expect(201);
    await request(srv).patch(`/api/consentimientos/${firmado}/estado`).set(adminH).send({ estado: 'firmado' }).expect(200);

    const revocado = await crearBorrador();
    await firmar(revocado).expect(201);
    await request(srv).patch(`/api/consentimientos/${revocado}/estado`).set(adminH).send({ estado: 'firmado' }).expect(200);
    await request(srv).patch(`/api/consentimientos/${revocado}/estado`).set(adminH).send({ estado: 'revocado' }).expect(200);

    const anulado = await crearBorrador();
    await request(srv).patch(`/api/consentimientos/${anulado}/estado`).set(adminH).send({ estado: 'anulado' }).expect(200);

    for (const id of [firmado, revocado, anulado]) {
      await firmar(id).expect(400);
    }
  });

  it('4. transiciones: firmar exige firma; inválidas → 400', async () => {
    const srv = app.getHttpServer();
    const id = await crearBorrador();
    // Sin firma del paciente no hay firmado posible.
    await request(srv).patch(`/api/consentimientos/${id}/estado`).set(adminH).send({ estado: 'firmado' }).expect(400);
    await firmar(id).expect(201);
    await request(srv).patch(`/api/consentimientos/${id}/estado`).set(adminH).send({ estado: 'firmado' }).expect(200);
    // Desde firmado no se vuelve atrás ni se anula por esta vía.
    await request(srv).patch(`/api/consentimientos/${id}/estado`).set(adminH).send({ estado: 'borrador' }).expect(400);

    const id2 = await crearBorrador();
    await request(srv).patch(`/api/consentimientos/${id2}/estado`).set(adminH).send({ estado: 'anulado' }).expect(200);
    await request(srv).patch(`/api/consentimientos/${id2}/estado`).set(adminH).send({ estado: 'firmado' }).expect(400);
  });

  it('5. descarga: 200 con bytes idénticos; sin permiso 403; JSON sin claves', async () => {
    const srv = app.getHttpServer();
    const id = await crearBorrador();
    await firmar(id).expect(201);

    const g = await request(srv).get(`/api/consentimientos/${id}`).set(adminH).expect(200);
    expect((g.body as Record<string, unknown>).firmaPacienteKey).toBeUndefined();

    const d = await request(srv).get(`/api/consentimientos/${id}/firmas/paciente`).set(adminH).expect(200);
    expect(d.headers['content-type']).toContain('image/png');
    const bytes = binario(d);
    expect(bytes.length).toBe(PNG_BYTES.length);
    expect(bytes.equals(PNG_BYTES)).toBe(true);

    // Rol sin firma adjunta: 404, no 200 vacío.
    await request(srv).get(`/api/consentimientos/${id}/firmas/odontologo`).set(adminH).expect(404);
    // Sin `consents.read`: 403 aunque el recurso sea propio.
    await request(srv).get(`/api/consentimientos/${id}/firmas/paciente`).set(acotadoH).expect(403);
  });

  it('6. aislamiento: lo de A no se lee ni se firma desde B', async () => {
    const srv = app.getHttpServer();
    const id = await crearBorrador();
    await firmar(id).expect(201);

    await request(srv).get(`/api/consentimientos/${id}`).set(adminBH).expect(404);
    await request(srv)
      .post(`/api/consentimientos/${id}/firmas`)
      .set(adminBH)
      .field('rol', 'paciente')
      .attach('archivo', PNG_BYTES, { filename: 'intrusa.png', contentType: 'image/png' })
      .expect(404);
    await request(srv).get(`/api/consentimientos/${id}/firmas/paciente`).set(adminBH).expect(404);
    // Y B no dejó huella: el estado y la firma de A siguen intactos.
    const fila = await db.consentimientoFirmado.findUnique({ where: { id } });
    expect(fila!.estado).toBe('borrador');
    expect(typeof fila!.firmaPacienteKey).toBe('string');

    // El listado respeta al tenant: con el paciente de B no se ve nada de A.
    await request(srv).get(`/api/consentimientos?pacienteId=${datos.b.pacienteId}`).set(adminH).expect(404);
    const lista = await request(srv).get(`/api/consentimientos?pacienteId=${datos.a.pacienteId}`).set(adminH).expect(200);
    const filas = (lista.body?.data ?? lista.body) as Array<{ tenantId: string }>;
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((f) => f.tenantId === datos.a.tenantId)).toBe(true);
    // Sin `pacienteId` no se vuelca todo: 400.
    await request(srv).get('/api/consentimientos').set(adminH).expect(400);
  });
});
