import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import {
  BadRequestException,
  Injectable,
  Module,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { Request } from 'express';
import { Platform } from '../../core/auth/platform.decorator.js';
import { Public } from '../../core/auth/public.decorator.js';
import { EntitlementsService } from '../../core/entitlements/entitlements.service.js';
import { PlatformGuard, PlatformRoles } from '../../core/guards/platform.guard.js';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import { EventoNormalizado, verificarHmac, verificarMercadoPago } from './verificadores.js';

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
    const clave = `chk-${dto.tenantId}-${dto.planCodigo}-${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}`;
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

  /** Procesa un webhook verificado de forma idempotente por eventId. */
  async procesar(proveedor: string, evento: EventoNormalizado, payload: unknown): Promise<{ ok: boolean; duplicado?: boolean }> {
    const previo = await this.db.webhookEvent.findUnique({ where: { eventId: evento.eventId } });
    if (previo) return { ok: true, duplicado: true };
    const reg = await this.db.webhookEvent.create({
      data: { proveedor, eventId: evento.eventId, tipo: evento.tipo, payload: (payload ?? {}) as object },
    });
    try {
      if (!evento.referencia) throw new Error('sin referencia al cobro');
      const cobro = await this.db.cobroSuscripcion.findUnique({ where: { id: evento.referencia } });
      if (!cobro) throw new Error('cobro desconocido');
      if (APROBADOS.has(evento.tipo)) {
        if (cobro.estado !== 'pagado') {
          await this.db.cobroSuscripcion.update({ where: { id: cobro.id }, data: { estado: 'pagado' } });
          // Extiende el periodo desde el mayor entre fin vigente y ahora.
          const sub = await this.db.subscription.findUnique({ where: { tenantId: cobro.tenantId } });
          if (sub) {
            const base = Math.max(new Date(sub.periodoFin).getTime(), Date.now());
            const dias = Math.round((new Date(cobro.periodoFin).getTime() - new Date(cobro.periodoInicio).getTime()) / 86400000) || 30;
            const fin = new Date(base);
            fin.setDate(fin.getDate() + dias);
            await this.db.subscription.update({
              where: { tenantId: cobro.tenantId },
              data: { estado: 'ACTIVE', periodoFin: fin },
            });
            this.entitlements.invalidate(cobro.tenantId);
          }
        }
      } else if (RECHAZADOS.has(evento.tipo)) {
        if (cobro.estado === 'pendiente') {
          await this.db.cobroSuscripcion.update({ where: { id: cobro.id }, data: { estado: 'fallido' } });
        }
      } else if (REEMBOLSOS.has(evento.tipo)) {
        await this.db.cobroSuscripcion.update({ where: { id: cobro.id }, data: { estado: 'reembolsado' } });
      } else {
        throw new Error(`tipo no soportado: ${evento.tipo}`);
      }
      await this.db.webhookEvent.update({ where: { id: (reg as { id: string }).id }, data: { estado: 'procesado', processedAt: new Date() } });
      return { ok: true };
    } catch (e) {
      await this.db.webhookEvent.update({
        where: { id: (reg as { id: string }).id },
        data: { estado: 'error', error: (e as Error).message },
      });
      return { ok: false };
    }
  }
}

function secretoDe(proveedor: string): string | null {
  if (proveedor === 'mercadopago') return process.env.BILLING_MP_SECRET ?? null;
  if (proveedor === 'hmac') return process.env.BILLING_HMAC_SECRET ?? null;
  return null;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly billing: BillingService) {}

  @Public()
  @Post(':proveedor')
  @HttpCode(200)
  async recibir(
    @Param('proveedor') proveedor: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<{ ok: boolean; duplicado?: boolean }> {
    if (!['hmac', 'mercadopago'].includes(proveedor)) {
      throw new NotFoundException('Proveedor no soportado');
    }
    const secreto = secretoDe(proveedor);
    if (!secreto) {
      throw new ServiceUnavailableException('Webhook no configurado');
    }
    const headers = req.headers as Record<string, string | undefined>;
    // El id firmado por MP viaja en la query de la notificación (`?data.id=`).
    const q = req.query as Record<string, unknown>;
    const idQuery =
      typeof q['data.id'] === 'string'
        ? q['data.id']
        : typeof q['id'] === 'string'
          ? q['id']
          : undefined;
    const evento =
      proveedor === 'mercadopago'
        ? verificarMercadoPago(
            secreto,
            headers['x-signature'],
            headers['x-request-id'],
            body,
            idQuery,
          )
        : verificarHmac(secreto, headers['x-signature'], body);
    if (!evento) throw new UnauthorizedException('Firma inválida');
    return this.billing.procesar(proveedor, evento, body);
  }
}

@Platform()
@UseGuards(PlatformGuard)
@ApiTags('platform-facturacion')
@Controller('platform/facturacion')
export class PlatformBillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  @PlatformRoles('owner', 'finanzas')
  checkout(@Body() dto: CheckoutDto): Promise<unknown> {
    return this.billing.checkout(dto);
  }

  @Post('dunning')
  @HttpCode(200)
  @PlatformRoles('owner')
  dunning(): Promise<unknown> {
    return this.billing.dunning();
  }

  @Get('cobros/:tenantId')
  @PlatformRoles('owner', 'finanzas')
  cobros(@Param('tenantId') tenantId: string): Promise<unknown> {
    return this.billing.cobrosDe(tenantId);
  }
}

@ApiTags('facturacion')
@Controller('facturacion')
export class FacturacionController {
  constructor(private readonly billing: BillingService) {}

  @Get('mis-cobros')
  @RequirePermission('payments.write')
  misCobros(): Promise<unknown> {
    return this.billing.misCobros();
  }
}

@Module({
  controllers: [WebhooksController, PlatformBillingController, FacturacionController],
  providers: [BillingService],
})
export class FacturacionModule {}
