import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { EntitlementsService } from '../../core/entitlements/entitlements.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import type { EventoNormalizado } from './verificadores.js';

export class CheckoutDto {
  @ApiProperty()
  @IsString()
  tenantId!: string;

  @ApiProperty({ example: 'clinica' })
  @IsString()
  planCodigo!: string;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  dias?: number;

  @ApiPropertyOptional({ example: 'hmac' })
  @IsOptional()
  @IsString()
  proveedor?: string;
}

type CobroRow = Record<string, unknown> & {
  id: string;
  tenantId: string;
  estado: string;
  periodoInicio: Date;
  periodoFin: Date;
};

type Db = {
  cobroSuscripcion: {
    findFirst: (a: unknown) => Promise<CobroRow | null>;
    findUnique: (a: unknown) => Promise<CobroRow | null>;
    create: (a: unknown) => Promise<CobroRow>;
    update: (a: unknown) => Promise<CobroRow>;
  };
  webhookEvent: {
    findUnique: (a: unknown) => Promise<{ id: string; estado: string } | null>;
    create: (a: unknown) => Promise<{ id: string }>;
    update: (a: unknown) => Promise<unknown>;
  };
  subscription: {
    findUnique: (a: unknown) => Promise<{
      estado: string;
      periodoFin: Date;
    } | null>;
    update: (a: unknown) => Promise<unknown>;
  };
  plan: {
    findMany: (a: unknown) => Promise<Array<{ id: string; precioMensual: unknown }>>;
  };
  tenant: {
    findUnique: (a: unknown) => Promise<{ id: string } | null>;
  };
};

const APROBADOS = new Set(['pago.aprobado', 'payment.approved']);
const RECHAZADOS = new Set(['pago.rechazado', 'payment.rejected']);
const REEMBOLSOS = new Set(['reembolso', 'charge.refunded']);

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private get db(): Db {
    return this.prisma as unknown as Db;
  }

  /** Checkout idempotente: misma (tenant, plan, mes) → mismo cobro. */
  async checkout(dto: CheckoutDto): Promise<CobroRow> {
    const tenant = await this.db.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    const planes = await this.db.plan.findMany({ where: { codigo: dto.planCodigo } });
    const plan = planes[0];
    if (!plan) throw new BadRequestException('Plan desconocido');
    const ahora = new Date();
    // Año/mes en UTC (invariante 4): la clave de idempotencia no puede depender
    // del huso horario del servidor.
    const clave = `chk-${dto.tenantId}-${dto.planCodigo}-${ahora.getUTCFullYear()}${String(ahora.getUTCMonth() + 1).padStart(2, '0')}`;
    const existente = await this.db.cobroSuscripcion.findUnique({ where: { claveIdempotencia: clave } });
    if (existente) return existente;
    const dias = dto.dias ?? 30;
    const fin = new Date(ahora);
    fin.setDate(fin.getDate() + dias);
    const sub = await this.db.subscription.findUnique({ where: { tenantId: dto.tenantId } });
    try {
      return await this.db.cobroSuscripcion.create({
        data: {
          tenantId: dto.tenantId,
          subscriptionId: (sub as unknown as { id?: string } | null)?.id ?? null,
          proveedor: dto.proveedor ?? 'hmac',
          monto: plan.precioMensual as number,
          moneda: 'PEN',
          claveIdempotencia: clave,
          periodoInicio: ahora,
          periodoFin: fin,
        },
      });
    } catch (e) {
      // Carrera de idempotencia: dos checkouts concurrentes con la misma clave
      // compiten por el @@unique. El perdedor NO debe recibir 409 — el contrato
      // de ADR-008 es devolver el cobro que ya existe, no fallar.
      if (e instanceof Error && 'code' in e && (e as { code: string }).code === 'P2002') {
        const creado = await this.db.cobroSuscripcion.findUnique({
          where: { claveIdempotencia: clave },
        });
        if (creado) return creado;
      }
      throw e;
    }
  }

  /** Dunning: ACTIVE vencida → PAST_DUE; PAST_DUE con 7+ días → SUSPENDED. */
  async dunning(): Promise<{ morosos: number; suspendidos: number }> {
    const db = this.prisma as unknown as {
      subscription: {
        findMany: (a: unknown) => Promise<Array<{ tenantId: string; estado: string; periodoFin: Date }>>;
        update: (a: unknown) => Promise<unknown>;
      };
    };
    const ahora = new Date();
    const subs = await db.subscription.findMany({});
    let morosos = 0;
    let suspendidos = 0;
    for (const s of subs) {
      if (s.estado === 'ACTIVE' && s.periodoFin.getTime() < ahora.getTime()) {
        await db.subscription.update({ where: { tenantId: s.tenantId }, data: { estado: 'PAST_DUE' } });
        this.entitlements.invalidate(s.tenantId);
        morosos++;
      } else if (s.estado === 'PAST_DUE' && s.periodoFin.getTime() < ahora.getTime() - 7 * 86400000) {
        await db.subscription.update({ where: { tenantId: s.tenantId }, data: { estado: 'SUSPENDED' } });
        this.entitlements.invalidate(s.tenantId);
        suspendidos++;
      }
    }
    return { morosos, suspendidos };
  }

  misCobros(): Promise<CobroRow[]> {
    const ctx = requireTenant();
    return (this.db.cobroSuscripcion as unknown as {
      findMany: (a: unknown) => Promise<CobroRow[]>;
    }).findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' } });
  }

  cobrosDe(tenantId: string): Promise<CobroRow[]> {
    return (this.db.cobroSuscripcion as unknown as {
      findMany: (a: unknown) => Promise<CobroRow[]>;
    }).findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }

  /**
   * Procesa un webhook verificado de forma idempotente por eventId.
   *
   * `tx` permite ejecutar evento + conciliación dentro de la transacción del
   * llamador (IPN de Izipay): o se registra y se concilia todo, o no queda
   * nada a medio camino y el reintento del gateway puede completarse.
   */
  async procesar(proveedor: string, evento: EventoNormalizado, payload: unknown, tx?: unknown): Promise<{ ok: boolean; duplicado?: boolean }> {
    const db = (tx as Db | null) ?? this.db;
    const previo = await db.webhookEvent.findUnique({ where: { eventId: evento.eventId } });
    if (previo) return { ok: true, duplicado: true };
    const reg = await db.webhookEvent.create({
      data: { proveedor, eventId: evento.eventId, tipo: evento.tipo, payload: (payload ?? {}) as object },
    });
    try {
      if (!evento.referencia) throw new Error('sin referencia al cobro');
      const cobro = await db.cobroSuscripcion.findUnique({ where: { id: evento.referencia } });
      if (!cobro) throw new Error('cobro desconocido');
      if (APROBADOS.has(evento.tipo)) {
        if (cobro.estado !== 'pagado') {
          await db.cobroSuscripcion.update({ where: { id: cobro.id }, data: { estado: 'pagado' } });
          // Extiende el periodo desde el mayor entre fin vigente y ahora.
          const sub = await db.subscription.findUnique({ where: { tenantId: cobro.tenantId } });
          if (sub) {
            const base = Math.max(new Date(sub.periodoFin).getTime(), Date.now());
            const dias = Math.round((new Date(cobro.periodoFin).getTime() - new Date(cobro.periodoInicio).getTime()) / 86400000) || 30;
            const fin = new Date(base);
            fin.setDate(fin.getDate() + dias);
            await db.subscription.update({
              where: { tenantId: cobro.tenantId },
              data: { estado: 'ACTIVE', periodoFin: fin },
            });
            this.entitlements.invalidate(cobro.tenantId);
          }
        }
      } else if (RECHAZADOS.has(evento.tipo)) {
        if (cobro.estado === 'pendiente') {
          await db.cobroSuscripcion.update({ where: { id: cobro.id }, data: { estado: 'fallido' } });
        }
      } else if (REEMBOLSOS.has(evento.tipo)) {
        await db.cobroSuscripcion.update({ where: { id: cobro.id }, data: { estado: 'reembolsado' } });
      } else {
        throw new Error(`tipo no soportado: ${evento.tipo}`);
      }
      await db.webhookEvent.update({ where: { id: (reg as { id: string }).id }, data: { estado: 'procesado', processedAt: new Date() } });
      return { ok: true };
    } catch (e) {
      await db.webhookEvent.update({
        where: { id: (reg as { id: string }).id },
        data: { estado: 'error', error: (e as Error).message },
      });
      return { ok: false };
    }
  }
}
