export type NivelCalendario = 'anios' | 'meses' | 'dias'

/** Nivel con el que puede configurarse la apertura del selector de fecha. */
export type NivelInicial = 'dias' | 'anios'

/**
 * Nivel con el que abre el selector.
 *
 * La agenda y los formularios operativos abren en el día (un clic menos por
 * cita); la fecha de nacimiento abre en el año (retroceder 30 años día a día
 * no es viable). Función pura para probarla sin navegador.
 */
export function nivelDeApertura(nivelInicial: NivelInicial): NivelCalendario {
  return nivelInicial
}

/**
 * Fecha civil en la que debe situarse el selector al abrir.
 *
 * Si hay valor, se respeta; si no, se cae en HOY (no en el máximo: con el
 * máximo por defecto 2100-12-31 el panel abría en el año 2100). Solo si hoy
 * está fuera del rango permitido se usa el máximo. Función pura para probarla
 * sin navegador (`hoy` se inyecta: normalmente `hoyLima()`).
 */
export function fechaDeApertura(
  valor: string | null | undefined,
  hoy: string,
  maximo: string,
): string {
  if (valor && valor.trim() !== '') return valor
  return hoy <= maximo ? hoy : maximo
}

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
