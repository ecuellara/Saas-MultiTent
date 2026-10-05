import { Injectable } from '@nestjs/common';
import * as path from 'node:path';

/**
 * Storage multi-tenant (doc §9).
 * - Claves bajo `tenants/{tenantId}/...`; el backend valida el prefijo
 *   antes de firmar o leer.
 * - Contención de rutas para el almacenamiento local (cierra path traversal:
 *   `resolve` + `startsWith`).
 * - Allowlist de MIME y tope de tamaño (magic bytes en etapa 2).
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
