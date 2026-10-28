import { describe, expect, it } from 'vitest';
import { comisionIzipay, totalConComision } from './comision.js';

/**
 * Valores documentados en docs/planes_saas_dental_2026.md §1.1
 * (precio en céntimos → total a cobrar en céntimos).
 */
const DOCUMENTADOS: Array<[number, number, number]> = [
  [7900, 420, 8320],   // S/ 79,00  → S/ 83,20
  [14900, 716, 15616], // S/ 149,00 → S/ 156,16
  [24900, 1139, 26039], // S/ 249,00 → S/ 260,39
];

describe('comisión de Izipay del plan (la asume la clínica)', () => {
  it('los tres valores documentados', () => {
    for (const [precio, comision, total] of DOCUMENTADOS) {
      expect(totalConComision(precio)).toBe(total);
    }
  });

  it('el desglose cuadra: comisión = total − precio', () => {
    for (const [precio, comision, total] of DOCUMENTADOS) {
      expect(comisionIzipay(precio)).toEqual({ comision, total });
    }
  });

  it('el total nunca recibe menos que el precio (redondeo hacia arriba)', () => {
    expect(comisionIzipay(1)).toEqual({ comision: 85, total: 86 });
    for (const [precio, , total] of DOCUMENTADOS) {
      expect(total).toBeGreaterThan(precio);
    }
  });

  it('rechaza importes inválidos sin floats en el resultado', () => {
    for (const v of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => comisionIzipay(v)).toThrow();
      expect(() => totalConComision(v)).toThrow();
    }
  });
});
