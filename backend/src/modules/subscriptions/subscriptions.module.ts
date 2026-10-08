import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';

/**
 * Suscripciones (doc §5.6 / plan §5.6).
 * El tenant NO puede leer la suscripción de otro ni modificar la propia
 * por HTTP: la facturación es manual desde el panel de plataforma (ADR-008).
 */
@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(tenantId: string): Promise<Record<string, unknown>> {
    const ctx = requireTenant();
    if (tenantId !== ctx.tenantId) throw new NotFoundException('Suscripción no encontrada');
    const db = this.prisma as unknown as {
      subscription: { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> };
    };
    const s = await db.subscription.findUnique({ where: { tenantId } });
    if (!s) throw new NotFoundException('Suscripción no encontrada');
    return s;
  }

  async modificar(): Promise<never> {
    // Cualquier intento HTTP de cambiar el plan se rechaza (403 en la matriz).
    throw new ForbiddenException('La suscripción solo se gestiona desde plataforma');
  }
}

@ApiTags('subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  @Get(':tenantId')
  @RequirePermission('payments.read')
  obtener(@Param('tenantId') tenantId: string): Promise<unknown> {
    return this.service.obtener(tenantId);
  }

  @Patch(':tenantId')
  modificar(
    @Param('tenantId') _tenantId: string,
    @Body() _body: Record<string, unknown>,
  ): Promise<never> {
    return this.service.modificar();
  }
}

@Module({ controllers: [SubscriptionsController], providers: [SubscriptionsService] })
export class SubscriptionsModule {}
