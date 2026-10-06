/**
 * Fechas para las pruebas.
 *
 * POR QUÉ: agendar en el pasado se rechaza a propósito (`CitasService`), así que
 * los specs de citas no pueden usar fechas fijas —caducan solas al pasar el
 * tiempo, que es justo lo que ocurrió con las de marzo y junio de 2026—. Se
 * calculan en el momento de ejecutar.
 */

/** Fecha civil `aaaa-mm-dd` a `dias` de distancia, en hora local del runner. */
export function fechaFutura(dias = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Igual que `fechaFutura`, pero hacia atrás (franjas que ya pasaron). */
export function fechaPasada(dias = 1): string {
  return fechaFutura(-dias);
}
