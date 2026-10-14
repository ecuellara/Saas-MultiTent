import { BadGatewayException, BadRequestException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { requireTenant, tenantContext } from '../../core/tenant-context/tenant-context.js';
import { PagosService } from './pagos.service.js';

export function aCentimos(valor: string): number {
  const decimal = new Prisma.Decimal(valor).mul(100);
  if (!decimal.isInteger() || !decimal.isPositive() || decimal.gt(Number.MAX_SAFE_INTEGER)) {
    throw new BadRequestException('Importe inválido para Izipay');
  }
  return decimal.toNumber();
}

export function desdeCentimos(valor: number): Prisma.Decimal {
  if (!Number.isSafeInteger(valor) || valor <= 0) throw new BadRequestException('Importe inválido');
  return new Prisma.Decimal(valor).div(100);
}

function configuracion() {
  const baseUrl = process.env.IZIPAY_BASE_URL;
  const shopId = process.env.IZIPAY_SHOP_ID;
  const clave = process.env.IZIPAY_CLAVE;
  const hmac = process.env.IZIPAY_CLAVE_HMAC;
  const publicKey = process.env.IZIPAY_PUBLIC_KEY;
  const faltantes = [
    ['IZIPAY_BASE_URL', baseUrl], ['IZIPAY_SHOP_ID', shopId],
    ['IZIPAY_CLAVE', clave], ['IZIPAY_CLAVE_HMAC', hmac],
    ['IZIPAY_PUBLIC_KEY', publicKey],
  ].filter(([, valor]) => !valor?.trim()).map(([nombre]) => nombre);
  if (faltantes.length || !baseUrl || !shopId || !clave || !hmac || !publicKey) {
    throw new ServiceUnavailableException(`Izipay no está configurado. Faltan variables en el proceso del backend: ${faltantes.join(', ')}`);
  }
  return { baseUrl, shopId, clave, hmac, publicKey };
}

type RespuestaIzipay = {
  shopId?: string;
  orderStatus?: string;
  orderDetails?: { orderId?: string };
  transactions?: Array<{ uuid?: string; status?: string; amount?: number; currency?: string }>;
};

/** REST V4: el navegador y el IPN usan claves distintas sobre el texto exacto. */
function verificarRespuesta(body: Record<string, unknown>, origen: 'ipn' | 'navegador') {
  const config = configuracion();
  const raw = body['kr-answer'];
  const hash = body['kr-hash'];
  const key = origen === 'ipn' ? 'password' : 'sha256_hmac';
  const secreto = origen === 'ipn' ? config.clave : config.hmac;
  if (body['kr-hash-key'] !== key || body['kr-hash-algorithm'] !== 'sha256_hmac' || typeof raw !== 'string' ||
      typeof hash !== 'string' || !/^[a-f0-9]{64}$/i.test(hash)) throw new UnauthorizedException('Firma inválida');
  const esperado = createHmac('sha256', secreto).update(raw, 'utf8').digest();
  if (!timingSafeEqual(esperado, Buffer.from(hash, 'hex'))) throw new UnauthorizedException('Firma inválida');
  let answer: RespuestaIzipay;
  try { answer = JSON.parse(raw); } catch { throw new BadRequestException('Aviso Izipay inválido'); }
  if (!answer || String(answer.shopId) !== config.shopId || typeof answer.orderDetails?.orderId !== 'string' ||
      !answer.orderDetails.orderId || typeof answer.orderStatus !== 'string' ||
      !Array.isArray(answer.transactions) || answer.transactions.length === 0 ||
      answer.transactions.some((t) => !t || typeof t.uuid !== 'string' || !t.uuid ||
        typeof t.status !== 'string' || !t.status || !Number.isSafeInteger(t.amount) ||
        (t.amount ?? 0) <= 0 || typeof t.currency !== 'string' || !t.currency)) {
    throw new BadRequestException('Aviso Izipay inválido');
  }
  return { raw, answer, orderId: answer.orderDetails.orderId, transactions: answer.transactions };
}

@Injectable()
export class IzipayService {
  constructor(private readonly prisma: PrismaService, private readonly pagos: PagosService) {}

  async formtoken(id: string): Promise<{ formToken: string; publicKey: string }> {
    const pago = await this.pagos.obtener(id);
    if (pago.deletedAt || pago.estado === 'anulado') throw new BadRequestException('Pago cancelado o anulado');
    if (pago.estado === 'pagado' || new Prisma.Decimal(String(pago.saldo)).lte(0)) {
      throw new BadRequestException('El pago ya está saldado');
    }
    if (pago.tipo !== 'ingreso' || !pago.pacienteId) throw new BadRequestException('Solo se pueden cobrar ingresos de pacientes');
    const config = configuracion();
    const ctx = requireTenant();
    const amount = aCentimos(String(pago.saldo));
    const orderId = randomUUID();
    const metadata = { pagoId: id, tenantId: ctx.tenantId, usuarioId: ctx.userId };
    const paciente = await this.prisma.paciente.findUnique({ where: { id: String(pago.pacienteId) } });
    if (!paciente || paciente.tenantId !== ctx.tenantId) throw new BadRequestException('Paciente no disponible');
    await this.prisma.intentoIzipay.create({ data: {
      orderId, pagoId: id, tenantId: ctx.tenantId, usuarioId: ctx.userId,
      importeCentimos: BigInt(amount), metadata,
    } });
    try {
      const respuesta = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api-payment/V4/Charge/CreatePayment`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${Buffer.from(`${config.shopId}:${config.clave}`).toString('base64')}` },
        body: JSON.stringify({ amount, currency: 'PEN', orderId, metadata, formAction: 'PAY', customer: {
          ...(paciente.email ? { email: paciente.email } : {}),
          billingDetails: { firstName: paciente.nombres, lastName: paciente.apellidos,
            phoneNumber: paciente.telefono ?? undefined, identityType: paciente.tipoDoc,
            identityCode: paciente.numDoc ?? undefined, address: paciente.direccion ?? undefined, country: 'PE' },
        } }),
      });
      const data = await respuesta.json() as { status?: string; answer?: { formToken?: string } };
      if (!respuesta.ok || data.status !== 'SUCCESS' || !data.answer?.formToken) throw new Error('gateway');
      return { formToken: data.answer.formToken, publicKey: config.publicKey };
    } catch {
      throw new BadGatewayException('No se pudo preparar el formulario de Izipay; vuelva a intentar');
    }
  }

  /** Solo valida el resultado visual. Nunca abona ni crea eventos de IPN. */
  async validarRetorno(id: string, body: Record<string, unknown>): Promise<{ valido: true; orderStatus: string }> {
    await this.pagos.obtener(id);
    const ctx = requireTenant();
    const { answer, orderId, transactions } = verificarRespuesta(body, 'navegador');
    const intento = await this.prisma.intentoIzipay.findUnique({ where: { orderId } });
    if (!intento || intento.pagoId !== id || intento.tenantId !== ctx.tenantId) {
      throw new BadRequestException('El resultado no corresponde a este pago');
    }
    if (transactions.some((t) => BigInt(t.amount!) !== intento.importeCentimos || t.currency !== intento.moneda)) {
      throw new BadRequestException('El importe o la moneda no coincide con el intento de pago');
    }
    return { valido: true, orderStatus: answer.orderStatus! };
  }

  async ipn(body: Record<string, unknown>): Promise<{ ok: boolean; duplicado?: boolean }> {
    const { raw, answer, orderId, transactions } = verificarRespuesta(body, 'ipn');
    const intento = await this.prisma.intentoIzipay.findUnique({ where: { orderId } });
    for (const transaccion of transactions) {
      const { uuid, status, amount, currency } = transaccion;
      if (!uuid || !status || !Number.isSafeInteger(amount) || (amount ?? 0) <= 0 || !currency) throw new BadRequestException('Transacción Izipay inválida');
      const aceptado = answer.orderStatus === 'PAID' && status === 'PAID';
      const claveIdempotencia = `izipay:${uuid}:${aceptado ? 'PAYMENT_ACCEPTED' : status}`;
      const procesar = async () => {
        try {
          await this.prisma.$transaction(async (tx) => {
            const previo = await tx.eventoIzipay.findUnique({ where: { claveIdempotencia } });
            if (previo) return;
            const coincide = intento && BigInt(amount!) === intento.importeCentimos && currency === intento.moneda;
            await tx.eventoIzipay.create({ data: {
              claveIdempotencia, orderId, transaccionId: uuid, tenantId: intento?.tenantId,
              estadoProveedor: status, importeCentimos: BigInt(amount!), moneda: currency,
              rawAnswer: raw, firmaValida: true,
              estado: !intento ? 'orden_desconocida' : !coincide ? 'importe_moneda_incorrectos' : aceptado ? 'procesado' : 'sin_cobro',
            } });
            if (coincide && aceptado) {
              const antes = await this.pagos.obtener(intento.pagoId, tx);
              const despues = await this.pagos.abonar(intento.pagoId, { monto: desdeCentimos(amount!).toNumber(), metodoPago: 'tarjeta' }, tx);
              await tx.auditoria.create({ data: {
                tenantId: intento.tenantId, usuarioId: null, tabla: 'pagos', registroId: intento.pagoId,
                accion: 'IZIPAY_ABONO', datosAnteriores: { montoPagado: String(antes.montoPagado), saldo: String(antes.saldo) },
                datosNuevos: { proveedor: 'izipay', transaccionId: uuid, orderId, solicitadoPor: intento.usuarioId, montoPagado: String(despues.montoPagado), saldo: String(despues.saldo) },
              } });
            }
          });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' &&
              await this.prisma.eventoIzipay.findUnique({ where: { claveIdempotencia } })) return;
          throw e;
        }
      };
      if (intento) await tenantContext.run({ tenantId: intento.tenantId, userId: intento.usuarioId, roleIds: [], permissions: [], validado: true }, procesar);
      else await procesar();
    }
    return { ok: true };
  }
}
