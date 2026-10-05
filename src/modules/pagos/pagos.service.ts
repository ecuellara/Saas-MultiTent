import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { SecuenciasService } from '../../core/secuencias/secuencias.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import type { AbonoDto, CreatePagoDto } from './pagos.dto.js';

type PagoRow = Record<string, unknown> & {
  id: string;
  tenantId: string;
  estado: string;
  montoTotal: number | { toNumber(): number } | string;
  montoPagado: number | { toNumber(): number } | string;
  saldo: number | { toNumber(): number } | string;
};

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v !== null && typeof v === 'object' && 'toNumber' in (v as object)) {
    return (v as { toNumber(): number }).toNumber();
  }
  return Number(v);
}

type Db = {
  pago: {
    findUnique: (a: unknown) => Promise<PagoRow | null>;
    findMany: (a: unknown) => Promise<PagoRow[]>;
    create: (a: unknown) => Promise<PagoRow>;
    update: (a: unknown) => Promise<PagoRow>;
  };
  paciente: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
  cita: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
  tratamiento: { findUnique: (a: unknown) => Promise<{ tenantId: string } | null> };
};

@Injectable()
export class PagosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secuencias: SecuenciasService,
  ) {}

  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  async listar(): Promise<PagoRow[]> {
    requireTenant();
    return this.db.pago.findMany({
      where: { deletedAt: null },
      orderBy: { fecha: 'desc' },
    });
  }

  async obtener(id: string): Promise<PagoRow> {
    const ctx = requireTenant();
    const p = await this.db.pago.findUnique({ where: { id } });
    if (!p || p.tenantId !== ctx.tenantId) throw new NotFoundException('Pago no encontrado');
    return p;
  }

  async crear(dto: CreatePagoDto): Promise<PagoRow> {
    const ctx = requireTenant();
    const montoPagado = dto.montoPagado ?? 0;
    if (montoPagado > dto.montoTotal) {
      throw new BadRequestException('montoPagado no puede superar montoTotal');
    }
    if (dto.pacienteId) {
      const p = await this.db.paciente.findUnique({ where: { id: dto.pacienteId } });
      if (!p || p.tenantId !== ctx.tenantId) throw new NotFoundException('Paciente no encontrado');
    }
    if (dto.citaId) {
      const c = await this.db.cita.findUnique({ where: { id: dto.citaId } });
      if (!c || c.tenantId !== ctx.tenantId) throw new NotFoundException('Cita no encontrada');
    }
    if (dto.detalles) {
      for (const d of dto.detalles) {
        if (d.tratamientoId) {
          const t = await this.db.tratamiento.findUnique({ where: { id: d.tratamientoId } });
          if (!t || t.tenantId !== ctx.tenantId) {
            throw new NotFoundException('Tratamiento no encontrado');
          }
        }
      }
    }
    const fecha = dto.fecha ? new Date(dto.fecha) : new Date();
    const saldo = dto.montoTotal - montoPagado;
    const estado = saldo === 0 ? 'pagado' : montoPagado > 0 ? 'parcial' : 'pendiente';

    for (let intento = 0; intento < 3; intento++) {
      const codigoRecibo = await this.secuencias.siguienteCodigoRecibo(fecha);
      try {
        return await this.db.pago.create({
          data: {
            tenantId: ctx.tenantId,
            codigoRecibo,
            tipo: dto.tipo,
            pacienteId: dto.pacienteId ?? null,
            citaId: dto.citaId ?? null,
            concepto: dto.concepto,
            montoTotal: dto.montoTotal,
            montoPagado,
            saldo,
            metodoPago: dto.metodoPago ?? null,
            estado,
            fecha,
            observacion: dto.observacion ?? null,
            usuarioId: ctx.userId,
            ...(dto.detalles?.length
              ? {
                  detalles: {
                    create: dto.detalles.map((d) => ({
                      tenantId: ctx.tenantId,
                      descripcion: d.descripcion,
                      tratamientoId: d.tratamientoId ?? null,
                      cantidad: d.cantidad,
                      precioUnit: d.precioUnit,
                      subtotal: d.cantidad * d.precioUnit,
                    })),
                  },
                }
              : {}),
            ...(dto.cuotas?.length
              ? {
                  cuotas: {
                    create: dto.cuotas.map((q) => ({
                      tenantId: ctx.tenantId,
                      nroCuota: q.nroCuota,
                      monto: q.monto,
                      fechaVencimiento: new Date(q.fechaVencimiento),
                    })),
                  },
                }
              : {}),
          },
        });
      } catch (e) {
        if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'P2002') {
          if (intento === 2) throw new ConflictException('No se pudo numerar el recibo');
          continue;
        }
        throw e;
      }
    }
    throw new ConflictException('No se pudo numerar el recibo');
  }

  /** Registra un abono: método/fecha por abono, tope y recálculo de saldo/estado. */
  async abonar(id: string, dto: AbonoDto): Promise<PagoRow> {
    const pago = await this.obtener(id);
    if (pago.estado === 'anulado') throw new BadRequestException('Pago anulado');
    const total = num(pago.montoTotal);
    const pagado = num(pago.montoPagado);
    const nuevoPagado = Math.round((pagado + dto.monto) * 100) / 100;
    if (nuevoPagado > total) {
      throw new BadRequestException('El abono supera el montoTotal');
    }
    const saldo = Math.round((total - nuevoPagado) * 100) / 100;
    return this.db.pago.update({
      where: { id },
      data: {
        montoPagado: nuevoPagado,
        saldo,
        estado: saldo === 0 ? 'pagado' : 'parcial',
        ...(dto.metodoPago ? { metodoPago: dto.metodoPago } : {}),
      },
    });
  }

  /** Anulación condicional: solo pendiente/parcial con saldo pendiente. */
  async anular(id: string): Promise<PagoRow> {
    const pago = await this.obtener(id);
    if (pago.estado === 'anulado') throw new BadRequestException('Pago ya anulado');
    if (pago.estado === 'pagado') {
      throw new BadRequestException('No se puede anular un pago totalmente pagado');
    }
    return this.db.pago.update({ where: { id }, data: { estado: 'anulado' } });
  }
}
