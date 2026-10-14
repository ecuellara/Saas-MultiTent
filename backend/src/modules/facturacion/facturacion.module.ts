import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Module, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Platform } from '../../core/auth/platform.decorator.js';
import { Public } from '../../core/auth/public.decorator.js';
import { PlatformGuard, PlatformRoles } from '../../core/guards/platform.guard.js';
import { RequirePermission } from '../../core/guards/require-permission.decorator.js';
import { verificarHmac, verificarMercadoPago } from './verificadores.js';
import { PasarelaModule } from '../../core/pasarela/pasarela.module.js';
import { BillingService, CheckoutDto } from './billing.service.js';
import { IzipaySuscripcionesService } from './izipay-suscripciones.service.js';

function secretoDe(proveedor: string): string | null {
  if (proveedor === 'mercadopago') return process.env.BILLING_MP_SECRET ?? null;
  if (proveedor === 'hmac') return process.env.BILLING_HMAC_SECRET ?? null;
  return null;
}

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly billing: BillingService, private readonly izipay: IzipaySuscripcionesService) {}

  @Public()
  @Post(':proveedor')
  @HttpCode(200)
  async recibir(
    @Param('proveedor') proveedor: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<{ ok: boolean; duplicado?: boolean }> {
    if (proveedor === 'izipay') return this.izipay.ipn(body);
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

/**
 * Plan de la propia clínica (`GET/POST /api/facturacion/mi-plan...`).
 * La pasarela solo cobra suscripciones: `payments.write` (cobrar a pacientes)
 * NO sirve aquí; se exige `billing.manage`.
 */
@ApiTags('mi-plan')
@Controller('facturacion/mi-plan')
export class MiPlanController {
  constructor(private readonly suscripciones: IzipaySuscripcionesService) {}

  @Get()
  @RequirePermission('billing.manage')
  miPlan(): Promise<unknown> {
    return this.suscripciones.miPlan();
  }

  @Post('formtoken')
  @RequirePermission('billing.manage')
  formtoken(): Promise<unknown> {
    return this.suscripciones.formtokenPlan();
  }

  @Post('validar-retorno')
  @RequirePermission('billing.manage')
  validarRetorno(@Body() body: Record<string, unknown>): Promise<unknown> {
    return this.suscripciones.validarRetorno(body);
  }
}

@Module({
  imports: [PasarelaModule],
  controllers: [WebhooksController, PlatformBillingController, FacturacionController, MiPlanController],
  providers: [BillingService, IzipaySuscripcionesService],
})
export class FacturacionModule {}
