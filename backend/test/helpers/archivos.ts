import type request from 'supertest';
import { StorageService } from '../../src/core/storage/storage.service.js';

/**
 * Bytes de prueba para subidas multipart.
 *
 * Centraliza lo que antes vivía duplicado en cada spec: un PNG mínimo real
 * (firma válida para `firmarMime`), un señuelo con nombre de imagen y un
 * constructor de archivos por encima del tope.
 */

/** PNG 1x1 real (firma PNG + IHDR/IEND mínimos). */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** Firma PNG (magic bytes). */
export const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Texto plano disfrazado de imagen: lo caza el sniffing, no la extensión. */
export const FALSO_PNG = Buffer.from('esto no es una imagen, solo texto con extension .png');

/**
 * PNG válido por firma pero por encima del tope (el resto son ceros: el
 * sniffing solo mira la cabecera, igual que en producción).
 */
export function pngGigante(): Buffer {
  return Buffer.concat([PNG_BYTES, Buffer.alloc(StorageService.MAX_KB * 1024)]);
}

/** Cuerpo binario de una respuesta de supertest. */
export function binario(r: request.Response): Buffer {
  return Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.text ?? '', 'binary');
}
