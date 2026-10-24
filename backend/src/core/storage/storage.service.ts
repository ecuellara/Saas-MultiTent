import { Injectable, NotFoundException } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
   * Proveedor activo. `local` (disco, por defecto: desarrollo y pruebas) o
   * `supabase` (Supabase Storage, producción). En Render el disco es efímero:
   * los archivos se perderían en cada despliegue, así que producción usa bucket.
   */
  get driver(): 'local' | 'supabase' {
    return process.env.STORAGE_DRIVER === 'supabase' ? 'supabase' : 'local';
  }

  /**
   * Configuración del bucket. Falla al USARLO —no al importar el módulo— y
   * nombrando la variable que falta, igual que la pasarela de pago.
   */
  private configuracionSupabase(): { url: string; key: string; bucket: string } {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const bucket = process.env.SUPABASE_STORAGE_BUCKET;
    if (!url) throw new Error('Falta SUPABASE_URL (necesaria con STORAGE_DRIVER=supabase)');
    if (!key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY (necesaria con STORAGE_DRIVER=supabase)');
    if (!bucket) throw new Error('Falta SUPABASE_STORAGE_BUCKET (necesaria con STORAGE_DRIVER=supabase)');
    return { url: url.replace(/\/$/, ''), key, bucket };
  }

  private urlObjeto(storageKey: string): string {
    const { url, bucket } = this.configuracionSupabase();
    const ruta = storageKey.split('/').map(encodeURIComponent).join('/');
    return `${url}/storage/v1/object/${bucket}/${ruta}`;
  }

  private cabecerasSupabase(): Record<string, string> {
    const { key } = this.configuracionSupabase();
    return { Authorization: `Bearer ${key}`, apikey: key };
  }

  /**
   * Escribe el contenido de un archivo del tenant en el proveedor activo.
   *
   * La clave la construye SIEMPRE el servidor (`construirClave`) y aquí se
   * revalida el prefijo del tenant **antes** de escribir, en los dos proveedores.
   */
  async guardar(tenantId: string, storageKey: string, contenido: Buffer): Promise<void> {
    this.assertClaveTenant(tenantId, storageKey);
    if (this.driver === 'supabase') {
      const respuesta = await fetch(this.urlObjeto(storageKey), {
        method: 'POST',
        headers: {
          ...this.cabecerasSupabase(),
          'Content-Type': 'application/octet-stream',
          'x-upsert': 'true',
        },
        body: contenido,
      });
      if (!respuesta.ok) {
        throw new Error(`Supabase Storage: no se pudo guardar (HTTP ${respuesta.status})`);
      }
      return;
    }
    const ruta = this.rutaLocal(storageKey);
    await mkdir(path.dirname(ruta), { recursive: true });
    await writeFile(ruta, contenido);
  }

  /**
   * Borra un archivo del tenant. No falla si ya no existe (acción compensatoria
   * cuando la escritura tuvo éxito pero la fila en base de datos no se creó).
   */
  async eliminar(storageKey: string): Promise<void> {
    if (this.driver === 'supabase') {
      const respuesta = await fetch(this.urlObjeto(storageKey), {
        method: 'DELETE',
        headers: this.cabecerasSupabase(),
      });
      if (!respuesta.ok && respuesta.status !== 404) {
        throw new Error(`Supabase Storage: no se pudo borrar (HTTP ${respuesta.status})`);
      }
      return;
    }
    await rm(this.rutaLocal(storageKey), { force: true });
  }

  /**
   * Lee una clave del tenant en el proveedor activo, sin validar el tipo de
   * contenido (de eso se encarga el llamador). Lanza 404 si no existe: nunca 500.
   */
  async leer(tenantId: string, storageKey: string): Promise<Buffer> {
    this.assertClaveTenant(tenantId, storageKey);
    if (this.driver === 'supabase') {
      const respuesta = await fetch(this.urlObjeto(storageKey), { headers: this.cabecerasSupabase() });
      if (!respuesta.ok) throw new NotFoundException('Documento no encontrado');
      return Buffer.from(await respuesta.arrayBuffer());
    }
    try {
      return await readFile(this.rutaLocal(storageKey));
    } catch {
      throw new NotFoundException('Documento no encontrado');
    }
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
   * Lee una clave del tenant en el proveedor activo y valida que el contenido
   * real coincida con el `mimeType` declarado en la fila. Lanza NotFoundException
   * (nunca 500) si no existe o si el contenido no es un tipo permitido.
   *
   * El endpoint de subida de bytes valida la firma ANTES de guardar; esta
   * comprobación es la que protege al servir (defensa en profundidad).
   */
  async leerDocumentoValidado(
    tenantId: string,
    storageKey: string,
    mimeTypeDeclarado: string,
  ): Promise<Buffer> {
    // Defensa en profundidad: la clave almacenada debe seguir siendo del tenant.
    this.assertClaveTenant(tenantId, storageKey);
    // `leer` resuelve el proveedor activo y ya lanza 404 si no existe.
    const contenido = await this.leer(tenantId, storageKey);
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
