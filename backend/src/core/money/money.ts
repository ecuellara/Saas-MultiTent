/**
 * Política monetaria única del proyecto (doc §13, mejora "unificar la política
 * de redondeo").
 *
 * Los importes se calculan en CÉNTIMOS ENTEROS: así el total es exactamente la
 * suma de los subtotales y no hay deriva binaria (0.1 + 0.2 !== 0.3). Todo
 * importe que se persista en un `Decimal(10,2)` debe pasar por `round2`.
 */

export function aCentimos(importe: number): number {
  return Math.round(importe * 100);
}

export function desdeCentimos(centimos: number): number {
  return centimos / 100;
}

/** Redondeo a 2 decimales, la única política admitida para dinero. */
export function round2(importe: number): number {
  return desdeCentimos(aCentimos(importe));
}
