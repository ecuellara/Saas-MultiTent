/**
 * Fecha civil real `YYYY-MM-DD`.
 *
 * El dominio de agenda guarda fechas civiles (`@db.Date`): un instante ISO con
 * hora u offset (`2026-11-10T23:00:00-05:00`) se truncaría en UTC y podría
 * guardar OTRO día; `2026-02-30` se normalizaría a marzo. Por eso no basta con
 * `@IsDateString()`: se exige estrictamente el día, y que exista en el calendario.
 */
export function esFechaCivil(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Fecha civil o la forma heredada `YYYY-MM-DDT00:00:00.000Z`.
 *
 * El frontend anterior enviaba la medianoche UTC completa en el cuerpo de
 * `POST/PATCH /citas`. Esa forma mapea al mismo día y se sigue aceptando para
 * que un despliegue desacompasado (API nueva + bundle antiguo en caché) no
 * rompa el alta de citas. Se rechaza cualquier instante con hora distinta de
 * medianoche o con offset, porque esos sí cambian de día al truncar en UTC.
 */
export function esFechaCivilOMedianocheUtc(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  if (esFechaCivil(v)) return true;
  const m = /^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/.exec(v);
  return m !== null && esFechaCivil(m[1]);
}

