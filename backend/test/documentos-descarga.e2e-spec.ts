/**
 * Documentos del paciente: la descarga debe entregar el ARCHIVO (no metadatos).
 *
 * Cubre los dos bugs corregidos:
 *  1. `GET /api/pacientes/:id/documentos/:docId/descarga` devolvía la fila
 *     `DocumentoPaciente` serializada como JSON (con la `storageKey` en claro).
 *  2. No se validaba el contenido real: `validarSubida` sólo comparaba el
 *     `mimeType` DECLARADO. Ahora se hace sniffing de firma (magic bytes) al
 *     servir y, si no coincide con la fila, se responde 404 sin entregar bytes.
 *
 * Nota: aquí SÍ se escribe en disco porque el backend no tiene endpoint de
 * subida de bytes; los archivos se preparan directamente en el directorio
 * `uploads/` del proveedor local, que coincide con `storageKey`.
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

/** PNG 1x1 real (firma 89 50 4E 47 0D 0A 1A 0A + IHDR/IEND mínimos). */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Texto plano: firma desconocida para la allowlist de storage. */
const TEXTO_PLANO = Buffer.from('<html><script>alert(1)</script></html>', 'utf8');

interface DocumentoRegistrado {
  id: string;
  storageKey: string;
  nombreArchivo: string;
  mimeType: string;
}

describe('Documentos: descarga del archivo y validación de contenido (magic bytes)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let datos: DosTenants;
  let tokenA: string;
  let tokenB: string;
  /** Rutas absolutas escritas por el spec, para limpiarlas en `afterAll`. */
  const archivosCreados: string[] = [];

  /** El binario llega como Buffer; si supertest lo decodifica, se rearma. */
  const binario = (r: request.Response): Buffer =>
    Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.text, 'binary');

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    await limpiarDosTenants(prisma);
    datos = await seedDosTenants(prisma);

    const loginA = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.a.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    tokenA = loginA.body.access_token;
    const loginB = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: datos.b.userEmail, password: PASSWORD_PLAIN })
      .expect(200);
    tokenB = loginB.body.access_token;
  }, 120_000);

  afterAll(async () => {
    for (const ruta of archivosCreados) {
      try {
        await fs.promises.rm(ruta, { force: true });
      } catch {
        // La limpieza del archivo no debe enmascarar el resultado de las pruebas.
      }
    }
    // Sólo se retiran directorios vacíos del tenant A, nunca el resto de uploads.
    const raizTenant = path.join(storage.uploadsBase, 'tenants', datos.a.tenantId);
    try {
      await fs.promises.rm(raizTenant, { recursive: true, force: true });
    } catch {
      // Idem: si otro proceso usa el directorio, se ignora.
    }
    if (prisma) await limpiarDosTenants(prisma);
    if (app) await app.close();
  });

  const cabeceras = (token: string, tenantId: string): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    'X-Tenant-Id': tenantId,
  });

  /** Registra un documento (metadatos) y devuelve la fila creada. */
  async function registrarDocumento(
    token: string,
    tenantId: string,
    pacienteId: string,
    cuerpo: Record<string, unknown>,
  ): Promise<DocumentoRegistrado> {
    const r = await request(app.getHttpServer())
      .post(`/api/pacientes/${pacienteId}/documentos`)
      .set(cabeceras(token, tenantId))
      .send(cuerpo)
      .expect(201);
    return r.body as DocumentoRegistrado;
  }

  /** Escribe bytes en la ruta de disco que corresponde a la `storageKey`. */
  async function escribirArchivo(storageKey: string, contenido: Buffer): Promise<string> {
    const ruta = storage.rutaLocal(storageKey);
    await fs.promises.mkdir(path.dirname(ruta), { recursive: true });
    await fs.promises.writeFile(ruta, contenido);
    archivosCreados.push(ruta);
    return ruta;
  }

  it('control: la storageKey se construye en el servidor bajo el tenant', async () => {
    const doc = await registrarDocumento(tokenA, datos.a.tenantId, datos.a.pacienteId, {
      nombreArchivo: 'control.png',
      tipo: 'RX_PERIAPICAL',
      mimeType: 'image/png',
      tamanioKb: 100,
    });
    expect(doc.storageKey.startsWith(`tenants/${datos.a.tenantId}/`)).toBe(true);
    // El cliente NO puede imponer la clave: `storageKey` no está en el DTO y
    // `forbidNonWhitelisted` la rechaza con 400. Antes se aceptaba (solo se
    // comprobaba el prefijo del tenant), lo que permitía registrar el documento
    // de un paciente apuntando al archivo de OTRO paciente del mismo tenant.
    await request(app.getHttpServer())
      .post(`/api/pacientes/${datos.a.pacienteId}/documentos`)
      .set(cabeceras(tokenA, datos.a.tenantId))
      .send({
        nombreArchivo: 'otro.png',
        tipo: 'RX_PERIAPICAL',
        mimeType: 'image/png',
        storageKey: `tenants/${datos.b.tenantId}/robado.png`,
      })
      .expect(400);
  });

  it('descarga un PNG real: 200, Content-Type image/png y firma correcta', async () => {
    const doc = await registrarDocumento(tokenA, datos.a.tenantId, datos.a.pacienteId, {
      nombreArchivo: 'radiografía real.png',
      tipo: 'RX_PERIAPICAL',
      mimeType: 'image/png',
      tamanioKb: 1,
    });
    await escribirArchivo(doc.storageKey, PNG_BYTES);

    const r = await request(app.getHttpServer())
      .get(`/api/pacientes/${datos.a.pacienteId}/documentos/${doc.id}/descarga`)
      .set(cabeceras(tokenA, datos.a.tenantId))
      .expect(200);

    expect(r.headers['content-type']).toContain('image/png');
    expect(r.headers['content-disposition']).toContain('attachment');
    // El nombre real (con acento) viaja en `filename*` (RFC 5987).
    expect(r.headers['content-disposition']).toContain("filename*=UTF-8''");
    const bytes = binario(r);
    expect(bytes.subarray(0, 8).equals(FIRMA_PNG)).toBe(true);
    expect(bytes.length).toBe(PNG_BYTES.length);
  });

  it('no entrega el contenido si el archivo no coincide con el mimeType declarado (404)', async () => {
    const doc = await registrarDocumento(tokenA, datos.a.tenantId, datos.a.pacienteId, {
      nombreArchivo: 'mentira.png',
      tipo: 'RX_PERIAPICAL',
      mimeType: 'image/png',
      tamanioKb: 1,
    });
    // Fila `image/png`, disco texto plano: XSS almacenado si se sirviera.
    await escribirArchivo(doc.storageKey, TEXTO_PLANO);

    const r = await request(app.getHttpServer())
      .get(`/api/pacientes/${datos.a.pacienteId}/documentos/${doc.id}/descarga`)
      .set(cabeceras(tokenA, datos.a.tenantId))
      .expect(404);
    const cuerpo = JSON.stringify(r.body ?? '') + (r.text ?? '');
    expect(cuerpo).not.toContain('alert(1)');
    expect(cuerpo).not.toContain('<html>');
  });

  it('devuelve 404 (no 500) cuando el archivo no existe en disco', async () => {
    const doc = await registrarDocumento(tokenA, datos.a.tenantId, datos.a.pacienteId, {
      nombreArchivo: 'fantasma.pdf',
      tipo: 'LABORATORIO',
      mimeType: 'application/pdf',
      tamanioKb: 10,
    });
    // No se escribe nada en disco para esta clave.
    const r = await request(app.getHttpServer())
      .get(`/api/pacientes/${datos.a.pacienteId}/documentos/${doc.id}/descarga`)
      .set(cabeceras(tokenA, datos.a.tenantId))
      .expect(404);
    expect(r.body.statusCode).toBe(404);
  });

  it('aislamiento: el tenant A no puede descargar el documento del tenant B (404)', async () => {
    const docB = await registrarDocumento(tokenB, datos.b.tenantId, datos.b.pacienteId, {
      nombreArchivo: 'de-b.png',
      tipo: 'RX_PERIAPICAL',
      mimeType: 'image/png',
      tamanioKb: 1,
    });
    // El archivo de B existe y es válido: si hubiera fuga, la descarga saldría 200.
    await escribirArchivo(docB.storageKey, PNG_BYTES);

    // B sí puede descargarlo (control del montaje del escenario).
    const rB = await request(app.getHttpServer())
      .get(`/api/pacientes/${datos.b.pacienteId}/documentos/${docB.id}/descarga`)
      .set(cabeceras(tokenB, datos.b.tenantId))
      .expect(200);
    expect(binario(rB).subarray(0, 8).equals(FIRMA_PNG)).toBe(true);

    // A no puede: ni con su propio paciente (el documento es de otro tenant)…
    await request(app.getHttpServer())
      .get(`/api/pacientes/${datos.a.pacienteId}/documentos/${docB.id}/descarga`)
      .set(cabeceras(tokenA, datos.a.tenantId))
      .expect(404);
    // …ni apuntando al paciente de B.
    await request(app.getHttpServer())
      .get(`/api/pacientes/${datos.b.pacienteId}/documentos/${docB.id}/descarga`)
      .set(cabeceras(tokenA, datos.a.tenantId))
      .expect(404);
  });
});
