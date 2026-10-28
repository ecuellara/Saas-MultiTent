import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { comisionIzipay, totalConComision } from '../../core/pasarela/comision.js';
import { aCentimos, configuracion, desdeCentimos, verificarFirma } from '../../core/pasarela/pasarela.js';
import { PasarelaService } from '../../core/pasarela/pasarela.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant } from '../../core/tenant-context/tenant-context.js';
import { BillingService } from './billing.service.js';

type CobroPlano = Record<string, unknown> & {
  id: string;
  tenantId: string;
  estado: string;
  monto: unknown;
  moneda: string;
  periodoInicio: Date;
  periodoFin: Date;
};

/** Desglose en texto decimal (S/ 83.20): el cliente NUNCA decide importes. */
function desglose(importeCentimos: number): { precio: string; comision: string; total: string } {
  const { comision, total } = comisionIzipay(importeCentimos);
  return {
    precio: desdeCentimos(importeCentimos).toFixed(2),
    comision: desdeCentimos(comision).toFixed(2),
    total: desdeCentimos(total).toFixed(2),
  };
}

/**
 * Izipay para el PLAN de la clínica (suscripción SaaS). Nunca toca `Pago`:
 * el intento apunta a `CobroSuscripcion` y la confirmación pasa por
 * `BillingService.procesar` (idempotente, extiende el periodo una sola vez).
 */
@Injectable()
export class IzipaySuscripcionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly pasarela: PasarelaService,
  ) {}

  /** Estado del plan para la pantalla «Mi plan» (plan, suscripción y cobros). */
  async miPlan(): Promise<unknown> {
    const ctx = requireTenant();
    const db = this.prisma as unknown as {
      subscription: { findUnique: (a: unknown) => Promise<Record<string, unknown> & { plan?: Record<string, unknown> } | null> };
      cobroSuscripcion: { findMany: (a: unknown) => Promise<CobroPlano[]> };
    };
    const sub = await db.subscription.findUnique({
      where: { tenantId: ctx.tenantId },
      include: { plan: true },
    });
    if (!sub) throw new NotFoundException('La clínica aún no tiene suscripción');
    const cobros = await db.cobroSuscripcion.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    const pendiente = [...cobros]
      .filter((c) => c.estado === 'pendiente')
      .sort((a, b) => new Date(a.periodoInicio).getTime() - new Date(b.periodoInicio).getTime())[0] ?? null;
    const plano = (c: CobroPlano) => ({
      id: c.id, monto: String(c.monto), moneda: c.moneda, estado: c.estado,
      periodoInicio: c.periodoInicio, periodoFin: c.periodoFin, proveedor: (c as { proveedor?: string }).proveedor ?? null,
    });
    // El cobro pendiente se muestra con desglose: el monto registrado es el
    // PRECIO del plan; lo que se cobra incluye la comisión de la pasarela.
    const pendienteConDesglose =
      pendiente === null
        ? null
        : { ...plano(pendiente), ...desglose(aCentimos(String(pendiente.monto))) };
    return {
      plan: {
        codigo: (sub.plan as { codigo: string }).codigo,
        nombre: (sub.plan as { nombre: string }).nombre,
        precioMensual: String((sub.plan as { precioMensual: unknown }).precioMensual),
        moneda: (sub.plan as { moneda?: string }).moneda ?? 'PEN',
      },
      subscription: { estado: sub.estado, periodoInicio: sub.periodoInicio, periodoFin: sub.periodoFin },
      cobroPendiente: pendienteConDesglose,
      cobros: cobros.map(plano),
    };
  }

  /**
   * Crea el intento y el `formToken` para el cobro PENDIENTE del tenant (el
   * más antiguo primero); si no hay ninguno, genera el del periodo con el
   * checkout idempotente. El importe sale SIEMPRE del servidor.
   */
  async formtokenPlan(): Promise<{ formToken: string; publicKey: string; cobroId: string; importe: { precio: string; comision: string; total: string; moneda: string } }> {
    const ctx = requireTenant();
    // Sin credenciales se falla ANTES de crear intento o cobro.
    configuracion();
    const db = this.prisma as unknown as {
      subscription: { findUnique: (a: unknown) => Promise<{ planId: string; plan: { codigo: string } } | null> };
      cobroSuscripcion: { findMany: (a: unknown) => Promise<CobroPlano[]> };
      tenantConfig: { findUnique: (a: unknown) => Promise<{ nombre: string; email: string | null; telefono: string | null } | null> };
      intentoIzipay: { create: (a: unknown) => Promise<unknown> };
    };
    const sub = await db.subscription.findUnique({ where: { tenantId: ctx.tenantId }, include: { plan: true } });
    if (!sub) throw new BadRequestException('La clínica aún no tiene suscripción');
    const pendientes = await db.cobroSuscripcion.findMany({
      where: { tenantId: ctx.tenantId, estado: 'pendiente' },
      orderBy: { periodoInicio: 'asc' },
      take: 1,
    });
    const cobro = pendientes[0] ??
      (await this.billing.checkout({ tenantId: ctx.tenantId, planCodigo: sub.plan.codigo, proveedor: 'izipay' }) as unknown as CobroPlano);
    if (cobro.estado !== 'pendiente') throw new BadRequestException('El cobro ya fue procesado');
    // El cobro registra el PRECIO del plan; lo que se cobra en Izipay es el
    // precio MÁS la comisión de la pasarela (docs/planes_saas_dental_2026.md
    // §1.1), para que la clínica reciba el precio íntegro.
    const precio = aCentimos(String(cobro.monto));
    const amount = totalConComision(precio);
    const orderId = randomUUID();
    const metadata = { cobroSuscripcionId: cobro.id, tenantId: ctx.tenantId, usuarioId: ctx.userId };
    const config = await db.tenantConfig.findUnique({ where: { tenantId: ctx.tenantId } });
    await db.intentoIzipay.create({ data: {
      orderId, tenantId: ctx.tenantId, usuarioId: ctx.userId,
      cobroSuscripcionId: cobro.id, importeCentimos: BigInt(amount), moneda: cobro.moneda, metadata,
    } });
    const { formToken, publicKey } = await this.pasarela.crearFormToken({
      importeCentimos: amount,
      moneda: cobro.moneda,
      orderId,
      metadata,
      descripcion: `Plan ${sub.plan.codigo} · periodo ${new Date(cobro.periodoInicio).toISOString().slice(0, 10)}`,
      ...(config ? { comprador: {
        ...(config.email ? { email: config.email } : {}),
        nombre: config.nombre,
        ...(config.telefono ? { telefono: config.telefono } : {}),
      } } : {}),
    });
    return { formToken, publicKey, cobroId: cobro.id, importe: { ...desglose(precio), moneda: cobro.moneda } };
  }

  /** Solo valida el resultado visual. JAMÁS marca nada como pagado. */
  async validarRetorno(body: Record<string, unknown>): Promise<{ valido: true; orderStatus: string }> {
    const ctx = requireTenant();
    const { answer, orderId, transactions } = verificarFirma(body, 'navegador');
    const intento = await (this.prisma as unknown as {
      intentoIzipay: { findUnique: (a: unknown) => Promise<{ tenantId: string; importeCentimos: bigint; moneda: string } | null> };
    }).intentoIzipay.findUnique({ where: { orderId } });
    if (!intento || intento.tenantId !== ctx.tenantId) {
      throw new BadRequestException('El resultado no corresponde a esta suscripción');
    }
    if (transactions.some((t) => BigInt(t.amount!) !== intento.importeCentimos || t.currency !== intento.moneda)) {
      throw new BadRequestException('El importe o la moneda no coincide con el intento de pago');
    }
    return { valido: true, orderStatus: answer.orderStatus! };
  }

  /**
   * IPN de suscripción: firma → intento por `orderId` → `BillingService.procesar`
   * (marca el cobro pagado y extiende el periodo, una sola vez aunque el aviso
   * se repita). Todo en UNA transacción: evento + conciliación o nada.
   */
  async ipn(body: Record<string, unknown>): Promise<{ ok: boolean; duplicado?: boolean }> {
    const { raw, answer, orderId, transactions } = verificarFirma(body, 'ipn');
    const intento = await (this.prisma as unknown as {
      intentoIzipay: { findUnique: (a: unknown) => Promise<{ tenantId: string; cobroSuscripcionId: string; importeCentimos: bigint; moneda: string } | null> };
    }).intentoIzipay.findUnique({ where: { orderId } });
    for (const transaccion of transactions) {
      const { uuid, status, amount, currency } = transaccion;
      if (!uuid || !status || !Number.isSafeInteger(amount) || (amount ?? 0) <= 0 || !currency) throw new BadRequestException('Transacción Izipay inválida');
      const aceptado = answer.orderStatus === 'PAID' && status === 'PAID';
      const claveIdempotencia = `izipay:${uuid}:${aceptado ? 'PAYMENT_ACCEPTED' : status}`;
      try {
        const resultado = await this.prisma.$transaction(async (tx) => {
          const previo = await tx.eventoIzipay.findUnique({ where: { claveIdempotencia } });
          if (previo) return { ok: true as const, duplicado: true as const };
          const coincide = !!intento && BigInt(amount!) === intento.importeCentimos && currency === intento.moneda;
          const estado = !intento ? 'orden_desconocida' : !coincide ? 'importe_moneda_incorrectos' : aceptado ? 'procesado' : 'sin_cobro';
          await tx.eventoIzipay.create({ data: {
            claveIdempotencia, orderId, transaccionId: uuid,
            tenantId: intento?.tenantId ?? null,
            cobroSuscripcionId: intento?.cobroSuscripcionId ?? null,
            estadoProveedor: status, importeCentimos: BigInt(amount!), moneda: currency,
            rawAnswer: raw, firmaValida: true, estado,
          } });
          if (estado === 'procesado') {
            const conciliado = await this.billing.procesar(
              'izipay',
              { eventId: claveIdempotencia, tipo: 'payment.approved', referencia: intento!.cobroSuscripcionId },
              raw,
              tx,
            );
            // Si la conciliación no pudo marcar el cobro, se revierte también
            // el evento: un reintento auténtico del gateway debe poder
            // completarse, no encontrar una clave ya usada sin efecto.
            if (!conciliado.ok) throw new Error('No se pudo conciliar el cobro');
          }
          return { ok: true as const };
        });
        if (resultado.duplicado) return { ok: true, duplicado: true };
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' &&
            await this.prisma.eventoIzipay.findUnique({ where: { claveIdempotencia } })) return { ok: true, duplicado: true };
        throw e;
      }
    }
    return { ok: true };
  }
}
