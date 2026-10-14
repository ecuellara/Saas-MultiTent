import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Motor genérico de Izipay REST V4 (no sabe qué se cobra: ni pagos de
 * pacientes ni suscripciones). La firma, la idempotencia y los céntimos están
 * verificados contra el sandbox real: no cambiar este comportamiento.
 */

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

export interface ConfiguracionIzipay {
  baseUrl: string;
  shopId: string;
  clave: string;
  hmac: string;
  publicKey: string;
}

export function configuracion(): ConfiguracionIzipay {
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

export interface TransaccionIzipay {
  uuid?: string;
  status?: string;
  amount?: number;
  currency?: string;
}

export interface RespuestaIzipay {
  shopId?: string;
  orderStatus?: string;
  orderDetails?: { orderId?: string };
  transactions?: TransaccionIzipay[];
}

export interface RespuestaVerificada {
  raw: string;
  answer: RespuestaIzipay;
  orderId: string;
  transactions: TransaccionIzipay[];
}

/**
 * REST V4: el navegador y el IPN usan claves distintas sobre el texto exacto.
 * `kr-answer` se firma CRUDO (sin parsear ni canonicalizar) y se compara en
 * tiempo constante. No reutilizar el verificador HMAC genérico: canonicaliza
 * el JSON y la firma no cuadraría.
 */
export function verificarFirma(body: Record<string, unknown>, origen: 'ipn' | 'navegador'): RespuestaVerificada {
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
