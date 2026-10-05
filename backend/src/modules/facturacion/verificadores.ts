import * as crypto from 'node:crypto';

/** JSON canónico (claves ordenadas) para firmar/verificar sin raw-body. */
export function canonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(o[k])}`)
    .join(',')}}`;
}

function seguro(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export interface EventoNormalizado {
  eventId: string;
  tipo: string;
  referencia: string | null;
}

/**
 * Contrato `hmac` (genérico, documentado para el gateway que se conecte):
 * header `x-signature: sha256=<hex HMAC-SHA256(secreto, JSONcanonico(body))>`,
 * body `{ event_id, tipo, referencia?, ... }`.
 */
export function verificarHmac(
  secreto: string,
  firma: string | undefined,
  body: unknown,
): EventoNormalizado | null {
  if (!firma || !firma.startsWith('sha256=')) return null;
  const esperada = `sha256=${crypto.createHmac('sha256', secreto).update(canonico(body)).digest('hex')}`;
  if (!seguro(firma, esperada)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.event_id !== 'string' || typeof b.tipo !== 'string') return null;
  return {
    eventId: `hmac-${b.event_id}`,
    tipo: b.tipo,
    referencia: typeof b.referencia === 'string' ? b.referencia : null,
  };
}

/**
 * Mercado Pago: `x-signature: ts=<ts>,v1=<hmac>` + `x-request-id`, manifiesto
 * `id:<data.id>;request-id:<rid>;ts:<ts>` (formato oficial MP). Frescura ±15 min.
 * Body esperado: `{ id?, action, data: { id }, metadata?: { referencia? } }`.
 */
export function verificarMercadoPago(
  secreto: string,
  firma: string | undefined,
  requestId: string | undefined,
  body: unknown,
): EventoNormalizado | null {
  if (!firma || !requestId) return null;
  const partes = Object.fromEntries(
    firma.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const ts = partes['ts'];
  const v1 = partes['v1'];
  if (!ts || !v1) return null;
  if (Math.abs(Date.now() - Number(ts) * 1000) > 15 * 60 * 1000) return null;
  const b = body as { data?: { id?: string }; action?: string; metadata?: { referencia?: string } };
  const dataId = b.data?.id;
  if (!dataId) return null;
  const manifiesto = `id:${dataId};request-id:${requestId};ts:${ts}`;
  const esperada = crypto.createHmac('sha256', secreto).update(manifiesto).digest('hex');
  if (!seguro(v1, esperada)) return null;
  return {
    eventId: `mp-${dataId}`,
    tipo: typeof b.action === 'string' ? b.action : 'desconocido',
    referencia: b.metadata?.referencia ?? null,
  };
}
