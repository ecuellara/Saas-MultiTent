import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { requireTenant } from '../tenant-context/tenant-context.js';

/**
 * Numeración secuencial por tenant (ADR-007).
 * Formatos: REC-<año>-NNNN, CIT-XXXXXX (legible), CMP-<año>-NNNN.
 * La unicidad la impone `@@unique([tenantId, codigo])`; aquí se genera
 * el siguiente candidato contando existentes y reintentando ante P2002.
 */
@Injectable()
export class SecuenciasService {
  constructor(private readonly prisma: PrismaService) {}

  async siguienteCodigoRecibo(fecha = new Date()): Promise<string> {
    const ctx = requireTenant();
    const year = fecha.getFullYear();
    const prefijo = `REC-${year}-`;
    const db = this.prisma as unknown as {
      pago: { count: (a: unknown) => Promise<number> };
    };
    const count = await db.pago.count({
      where: { tenantId: ctx.tenantId, codigoRecibo: { startsWith: prefijo } },
    });
    // La unicidad final la impone @@unique([tenantId, codigoRecibo]);
    // ante P2002 el llamador reintenta.
    return `${prefijo}${String(count + 1).padStart(4, '0')}`;
  }

  async siguienteTokenCita(): Promise<string> {
    const ctx = requireTenant();
    const db = this.prisma as unknown as {
      cita: { count: (a: unknown) => Promise<number> };
    };
    const total = await db.cita.count({ where: { tenantId: ctx.tenantId } });
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, 'X');
    return `CIT-${String(total + 1).padStart(4, '0')}${rand}`.slice(0, 10);
  }

  async siguienteCodigoCompra(fecha = new Date()): Promise<string> {
    const ctx = requireTenant();
    const year = fecha.getFullYear();
    const prefijo = `CMP-${year}-`;
    const db = this.prisma as unknown as {
      compra: { count: (a: unknown) => Promise<number> };
    };
    const count = await db.compra.count({
      where: { tenantId: ctx.tenantId, codigo: { startsWith: prefijo } },
    });
    return `${prefijo}${String(count + 1).padStart(4, '0')}`;
  }
}
