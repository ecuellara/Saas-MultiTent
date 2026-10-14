export type NivelCalendario = 'anios' | 'meses' | 'dias'

/** Seleccionar año nunca debe saltar directamente a los días. */
export function siguienteNivel(nivel: NivelCalendario): NivelCalendario {
  if (nivel === 'anios') return 'meses'
  if (nivel === 'meses') return 'dias'
  return 'dias'
}

export function fechaCalendario(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function diaFueraDeRango(fecha: string, min: string, max: string): boolean {
  return fecha < min || fecha > max
}

export function mesFueraDeRango(y: number, m: number, min: string, max: string): boolean {
  const primero = fechaCalendario(y, m, 1)
  const ultimo = fechaCalendario(y, m, new Date(y, m, 0).getDate())
  return ultimo < min || primero > max
}
