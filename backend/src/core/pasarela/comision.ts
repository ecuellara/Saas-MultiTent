/**
 * Comisión de Izipay para el cobro del PLAN de la clínica (la asume la
 * clínica). Documentada en docs/planes_saas_dental_2026.md §1.1:
 *
 * 3,44 % del valor de la operación más 18 % de IGV sobre esa comisión
 * (4,0592 % efectivo), más S/ 0,69 + IGV por canal virtual (S/ 0,8142).
 *
 * Para que la clínica reciba el precio del plan íntegro:
 *
 *   total = redondeo HACIA ARRIBA al céntimo de
 *           (precio + 0,8142) / (1 − 0,040592)
 *
 * Aritmética entera en micro-céntimos (BigInt): ninguna fracción intermedia
 * pasa por floats, así que el redondeo hacia arriba es exacto.
 */

const MICRO = 1_000_000n;
// 3,44 % × 1,18 = 4,0592 % (por millón).
const TASA_POR_MICRO = 40_592n;
// S/ 0,69 + IGV = S/ 0,8142 → 81,42 céntimos → 81 420 000 micro-céntimos.
const FIJA_POR_MICRO = 81_420_000n;
// 1 − 0,040592 = 0,959408 (por millón).
const DENOMINADOR = MICRO - TASA_POR_MICRO;

export interface ComisionIzipay {
  /** Comisión en céntimos (total − precio). */
  comision: number;
  /** Total a cobrar, en céntimos. */
  total: number;
}

function validar(importeCentimos: number): void {
  if (!Number.isSafeInteger(importeCentimos) || importeCentimos <= 0) {
    throw new Error('Importe inválido para aplicar la comisión de Izipay');
  }
}

function redondearHaciaArriba(numerador: bigint, denominador: bigint): bigint {
  return (numerador + denominador - 1n) / denominador;
}

/**
 * Comisión y total (ambos en céntimos) para recibir `importeCentimos`
 * íntegros tras pasar por Izipay. Los tres valores documentados:
 * 7900 → 420 / 8320 · 14900 → 716 / 15616 · 24900 → 139 / 26039.
 */
export function comisionIzipay(importeCentimos: number): ComisionIzipay {
  validar(importeCentimos);
  const numerador = BigInt(importeCentimos) * MICRO + FIJA_POR_MICRO;
  const total = Number(redondearHaciaArriba(numerador, DENOMINADOR));
  return { comision: total - importeCentimos, total };
}

/** Importe (en céntimos) que debe enviarse a Izipay para quedar íntegro. */
export function totalConComision(importeCentimos: number): number {
  return comisionIzipay(importeCentimos).total;
}
