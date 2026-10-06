/**
 * Subida real de documentos (multipart).
 *
 * Antes sólo existía `POST /:id/documentos`, que registraba METADATOS: se podía
 * anotar una radiografía pero el archivo no se subía nunca, así que la función
 * clínica de documentos no servía en producción. Este spec fija el contrato del
 * endpoint que sí recibe los bytes.
 *
 * Lo que se comprueba, y por qué importa:
 *  - el **tipo** lo decide el CONTENIDO (magic bytes), no el `mimetype` que
 *    declara el cliente: un HTML renombrado a `.png` debe rechazarse;
 *  - el **tamaño** es el real (`file.size`), no un campo del formulario;
 *  - la **clave** la construye el servidor bajo `tenants/<tenant>/...` y no se
 *    devuelve al cliente;
 *  - ida y vuelta completa: lo subido se descarga idéntico.
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { StorageService } from '../src/core/storage/storage.service.js';
import { PASSWORD_PLAIN, limpiarDosTenants, seedDosTenants, type DosTenants } from './helpers/tenants-fixture.js';

/** PNG 1x1 real (firma PNG + IHDR/IEND mínimos). */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Db = {
  documentoPaciente: {
    findMany: (a: unknown) => Promise<Array<{ id: string; storageKey: string; mimeType: string }>>;
  };
};

/** Cuerpo binario de una respuesta de supertest. */
function binario(r: request.Response): Buffer {
  return Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.text ?? '', 'binary');
}

describe('Subida de documentos (multipart)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: Db;
  let storage: StorageService;
  let datos: DosTenants;
  let H: Record<string, string>;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    db = prisma as unknown as Db;
    storage = app.get(StorageService);

    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    H = { Authorization: `Bearer ${login.body.access_token}`, 'X-Tenant-Id': datos.a.tenantId };
  }, 120_000);

  afterAll(async () => {
    if (prisma) {
      // Se borran primero los ARCHIVOS (la fila ya no los referencia tras el
      // borrado en cascada del tenant) y luego el directorio del tenant.
      const filas = await db.documentoPaciente.findMany({
        where: { tenantId: datos.a.tenantId },
      });
      for (const f of filas) {
        try {
          await fs.promises.rm(storage.rutaLocal(f.storageKey), { force: true });
        } catch {
          // La limpieza no debe enmascarar el resultado de las pruebas.
        }
      }
      const raiz = path.join(storage.uploadsBase, 'tenants', datos.a.tenantId);
      try {
        await fs.promises.rm(raiz, { recursive: true, force: true });
      } catch {
        // Idem.
      }
      await limpiarDosTenants(prisma);
    }
    if (app) await app.close();
  });

  const subir = (pacienteId: string) =>
    request(app.getHttpServer()).post(`/api/pacientes/${pacienteId}/documentos/archivo`).set(H);

  it('sube un PNG y la clave queda bajo el tenant (sin exponerla)', async () => {
    const r = await subir(datos.a.pacienteId)
      .field('tipo', 'RX_PERIAPICAL')
      .attach('archivo', PNG_BYTES, { filename: 'radiografia.png', contentType: 'image/png' })
      .expect(201);

    const doc = r.body as Record<string, unknown>;
    // El MIME lo decide el contenido real, no el `contentType` de la parte.
    expect(doc.mimeType).toBe('image/png');
    expect(Number(doc.tamanioKb)).toBeGreaterThanOrEqual(1);
    // La ruta interna no se devuelve.
    expect(doc.storageKey).toBeUndefined();

    const filas = await db.documentoPaciente.findMany({ where: { id: String(doc.id) } });
    expect(filas).toHaveLength(1);
    expect(filas[0]!.storageKey.startsWith(`tenants/${datos.a.tenantId}/`)).toBe(true);
    // Y el archivo está de verdad en disco.
    expect(fs.existsSync(storage.rutaLocal(filas[0]!.storageKey))).toBe(true);
  });

  it('ida y vuelta: lo subido se descarga idéntico', async () => {
    const r = await subir(datos.a.pacienteId)
      .field('tipo', 'FOTO')
      .attach('archivo', PNG_BYTES, { filename: 'foto clinica.png', contentType: 'image/png' })
      .expect(201);
    const id = String((r.body as { id: string }).id);

    const desc = await request(app.getHttpServer())
      .get(`/api/pacientes/${datos.a.pacienteId}/documentos/${id}/descarga`)
      .set(H)
      .expect(200);

    expect(desc.headers['content-type']).toContain('image/png');
    const bytes = binario(desc);
    expect(bytes.length).toBe(PNG_BYTES.length);
    expect(bytes.equals(PNG_BYTES)).toBe(true);
    expect(bytes.subarray(0, 8).equals(FIRMA_PNG)).toBe(true);
  });

  it('rechaza contenido que no corresponde a ningún tipo permitido', async () => {
    // Texto plano disfrazado de PNG: antes se aceptaba como metadato y se
    // servía después; ahora se corta en la subida.
    await subir(datos.a.pacienteId)
      .field('tipo', 'RX_PERIAPICAL')
      .attach('archivo', Buffer.from('<html><script>alert(1)</script></html>'), {
        filename: 'malicioso.png',
        contentType: 'image/png',
      })
      .expect(400);

    // Y no queda ninguna fila apuntando a un archivo que nunca se escribió.
    const filas = await db.documentoPaciente.findMany({
      where: { tenantId: datos.a.tenantId, nombreArchivo: 'malicioso.png' },
    });
    expect(filas).toHaveLength(0);
  });

  it('rechaza la subida sin archivo y con un tipo no permitido', async () => {
    await subir(datos.a.pacienteId).field('tipo', 'FOTO').expect(400);
    await subir(datos.a.pacienteId)
      .field('tipo', 'NO_EXISTE')
      .attach('archivo', PNG_BYTES, { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
  });

  it('corta un archivo que supera el tope de tamaño (multer → 413)', async () => {
    const grande = Buffer.concat([PNG_BYTES, Buffer.alloc(StorageService.MAX_KB * 1024)]);
    await subir(datos.a.pacienteId)
      .field('tipo', 'RX_PANORAMICA')
      .attach('archivo', grande, { filename: 'enorme.png', contentType: 'image/png' })
      .expect(413);
  });

  it('aislamiento: no se puede subir al paciente de otro tenant', async () => {
    await subir(datos.b.pacienteId)
      .field('tipo', 'FOTO')
      .attach('archivo', PNG_BYTES, { filename: 'ajeno.png', contentType: 'image/png' })
      .expect(404);
  });
});
