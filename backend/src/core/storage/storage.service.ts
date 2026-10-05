import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Storage multi-tenant (doc §9).
 * - Claves bajo `tenants/{tenantId}/...`; el backend valida el prefijo
 *   antes de firmar o leer.
 * - Contención de rutas para el almacenamiento local (cierra path traversal:
 *   `resolve` + `startsWith`).
 * - Allowlist de MIME y tope de tamaño declarados, más sniffing de firma
 *   (magic bytes) del contenido real al servir.
 */
@Injectable()
export class StorageService {
  static readonly MIME_PERMITIDOS = new Set([
    'image/png',
    'image/jpeg',
    'application/pdf',
  ]);

  static readonly MAX_KB = 20 * 1024;

  prefijoTenant(tenantId: string): string {
    return `tenants/${tenantId}/`;
  }

  /** Lanza si la clave no pertenece al tenant o contiene `..`. */
  assertClaveTenant(tenantId: string, storageKey: string): string {
    const key = storageKey.replace(/^\/+/, '');
    if (key.includes('..')) throw new Error('Clave con traversal');
    if (!key.startsWith(this.prefijoTenant(tenantId))) {
      throw new Error('Clave fuera del tenant');
    }
    return key;
  }

  construirClave(tenantId: string, ...partes: string[]): string {
    const limpia = partes
      .map((p) => p.replace(/^\/+|\/+$/g, '').replace(/\.\./g, ''))
      .filter(Boolean);
    return `${this.prefijoTenant(tenantId)}${limpia.join('/')}`;
  }

  validarSubida(mimeType: string, tamanioKb?: number): void {
    if (!StorageService.MIME_PERMITIDOS.has(mimeType)) {
      throw new Error(`MIME no permitido: ${mimeType}`);
    }
    if (tamanioKb !== undefined && tamanioKb > StorageService.MAX_KB) {
      throw new Error('Archivo demasiado grande');
    }
  }

  /**
   * Directorio base del proveedor local. Se resuelve en cada llamada (no al
   * importar el módulo) para respetar el `cwd` del proceso en ejecución.
   */
  get uploadsBase(): string {
    return path.resolve(process.env.UPLOADS_DIR ?? 'uploads');
  }

  /**
   * Ruta absoluta en disco de una clave (proveedor local), con contención.
   * Existe para que las pruebas puedan preparar/limpiar archivos sin duplicar
   * la lógica de resolución.
   */
  rutaLocal(storageKey: string): string {
    return this.resolverLocal(this.uploadsBase, storageKey);
  }

  /**
   * Sniffing de firma (magic bytes) del contenido real.
   *
   * Motivo: `validarSubida` sólo compara el `mimeType` DECLARADO por el cliente
   * contra la allowlist, y el cliente puede mentir (p. ej. registrar un HTML
   * como `image/png` y provocar XSS almacenado al servirlo). Aquí se mira el
   * contenido de verdad antes de entregarlo.
   *
   * Devuelve el MIME detectado o `null` si la firma no corresponde a ningún
   * tipo permitido.
   */
  firmarMime(buffer: Buffer): string | null {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      return 'image/png';
    }
    // JPEG: FF D8 FF
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return 'image/jpeg';
    }
    // PDF: %PDF- (la cabecera puede no empezar en el byte 0)
    if (buffer.length >= 5 && buffer.subarray(0, 1024).includes('%PDF-')) {
      return 'application/pdf';
    }
    return null;
  }

  /**
   * Lee del disco una clave del tenant y valida que el contenido real coincida
   * con el `mimeType` declarado en la fila. Lanza NotFoundException (nunca 500)
   * si el archivo no existe o si el contenido no es un tipo permitido.
   *
   * NOTA: la validación equivalente "al subir" —firma del buffer entrante y
   * tamaño real desde `file.size` en lugar del `tamanioKb` declarado— pertenece
   * al endpoint de subida de bytes, que todavía NO existe en este backend (los
   * documentos se registran como metadatos). Por eso la comprobación efectiva
   * hoy es la de este método, al servir.
   */
  async leerDocumentoValidado(
    tenantId: string,
    storageKey: string,
    mimeTypeDeclarado: string,
  ): Promise<Buffer> {
    // Defensa en profundidad: la clave almacenada debe seguir siendo del tenant
    // y no puede escapar del directorio base.
    this.assertClaveTenant(tenantId, storageKey);
    let ruta: string;
    try {
      ruta = this.rutaLocal(storageKey);
    } catch {
      // Contención de rutas: se trata como "no existe", nunca como 500.
      throw new NotFoundException('Documento no encontrado');
    }

    let contenido: Buffer;
    try {
      contenido = await readFile(ruta);
    } catch {
      // Fila en BD sin archivo en disco → 404, no 500.
      throw new NotFoundException('Documento no encontrado');
    }

    const detectado = this.firmarMime(contenido);
    if (!detectado || detectado !== mimeTypeDeclarado) {
      // No se revela el motivo real: el cliente sólo ve un 404. El incidente
      // queda en el log del servidor para auditoría/diagnóstico.
      // eslint-disable-next-line no-console
      console.warn(
        `[storage] contenido no coincide con el mimeType declarado (tenant=${tenantId}, declarado=${mimeTypeDeclarado}, detectado=${detectado ?? 'desconocido'})`,
      );
      throw new NotFoundException('Documento no encontrado');
    }
    return contenido;
  }

  /** Resuelve una clave dentro de un directorio base, rechazando escapes. */
  resolverLocal(baseDir: string, storageKey: string): string {
    const abs = path.resolve(baseDir, storageKey.replace(/^\/+/, ''));
    const base = path.resolve(baseDir);
    if (abs !== base && !abs.startsWith(base + path.sep)) {
      throw new Error('Ruta fuera del directorio base');
    }
    return abs;
  }
}
