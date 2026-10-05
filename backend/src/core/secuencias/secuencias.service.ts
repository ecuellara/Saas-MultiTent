import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireTenant } from '../tenant-context/tenant-context.js';

/**
 * Numeración por tenant (ADR-007).
 * Formatos: `REC-<año>-NNNN`, `CMP-<año>-NNNN` y `CIT-XXXXXXXX` (token opaco).
 *
 * La unicidad la impone `@@unique([tenantId, codigo])`: aquí se genera el
 * siguiente CANDIDATO y el llamador reintenta ante `P2002` (pagos, citas y
 * compras lo hacen).
 */
@Injectable()
export class SecuenciasService {
  constructor(private readonly prisma: PrismaService) {}

  async siguienteCodigoRecibo(fecha = new Date()): Promise<string> {
    const ctx = requireTenant();
    const prefijo = `REC-${fecha.getFullYear()}-`;
    const db = this.prisma as unknown as {
      pago: { findMany: (a: unknown) => Promise<Array<{ codigoRecibo: string | null }>> };
    };
    const filas = await db.pago.findMany({
      where: { tenantId: ctx.tenantId, codigoRecibo: { startsWith: prefijo } },
      select: { codigoRecibo: true },
    });
    return this.siguienteDe(
      prefijo,
      filas.map((f) => f.codigoRecibo),
    );
  }

  /**
   * Token de cita OPACO: sin parte secuencial, así que no se puede enumerar ni
   * hace falta contar filas. Antes se truncaba a `CIT-0001AB`, dejando solo DOS
   * caracteres aleatorios (~1.300 combinaciones). 4 bytes en hex son 8
   * caracteres (≈4·10⁹) y la unicidad la garantiza `@@unique([tenantId, token])`
   * con reintento del llamador.
   */
  siguienteTokenCita(): string {
    return `CIT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  async siguienteCodigoCompra(fecha = new Date()): Promise<string> {
    const ctx = requireTenant();
    const prefijo = `CMP-${fecha.getFullYear()}-`;
    const db = this.prisma as unknown as {
      compra: { findMany: (a: unknown) => Promise<Array<{ codigo: string | null }>> };
    };
    const filas = await db.compra.findMany({
      where: { tenantId: ctx.tenantId, codigo: { startsWith: prefijo } },
      select: { codigo: true },
    });
    return this.siguienteDe(
      prefijo,
      filas.map((f) => f.codigo),
    );
  }

  /**
   * Siguiente correlativo calculado sobre el MÁXIMO numérico existente, no sobre
   * el CONTEO de filas.
   *
   * Con `count+1` cualquier hueco hacía que se reutilizara un número YA emitido:
   * si se crean 0001, 0002 y 0003 y se elimina el 0002 (una transacción
   * revertida, una baja), el conteo vuelve a 2 y el siguiente intento genera
   * 0003 otra vez, que ya existe → P2002 y reintentos fallidos.
   *
   * Comparar numéricamente en lugar de como texto evita además que al superar
   * 9999 el máximo detectado se quede clavado en 9999.
   *
   * LÍMITE CONOCIDO: si se elimina el código MÁS ALTO del periodo, el número se
   * recicla (MAX baja). La solución definitiva es una tabla de contadores por
   * tenant (`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`), que el documento
   * contempla para cuando el volumen lo justifique; evita además el recorrido
   * de códigos del periodo que se hace aquí.
   */
  private siguienteDe(prefijo: string, codigos: Array<string | null>): string {
    let max = 0;
    for (const c of codigos) {
      if (!c || !c.startsWith(prefijo)) continue;
      const n = Number.parseInt(c.slice(prefijo.length), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return `${prefijo}${String(max + 1).padStart(4, '0')}`;
  }
}
