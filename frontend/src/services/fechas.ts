/**
 * Utilidades de fecha compartidas por todos los módulos.
 *
 * Viven aquí y no dentro de un servicio de dominio porque las usan pacientes,
 * citas, pagos y odontograma: dejarlas en `pacientes.ts` obligaba a cada módulo a
 * importar del dominio de otro.
 *
 * LA DISTINCIÓN QUE IMPORTA:
 * - **Fecha sin hora** (nacimiento, `Cita.fecha`, `HistorialClinico.fecha`,
 *   vencimiento de cuota): se guarda como medianoche UTC, así que se formatea con
 *   `timeZone: 'UTC'`. En hora local se vería **un día antes** en husos negativos
 *   (Lima es UTC-5): el 09/03 aparecería como 08/03.
 * - **Instante real** (`createdAt`, `firmadoEn`): se formatea en la hora del
 *   usuario.
 */

/** Formatea un INSTANTE ISO a `dd/mm/aaaa` en la hora del usuario. */
export function formatearFecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** Formatea una FECHA SIN HORA en UTC (ver nota de arriba). */
export function formatearFechaUTC(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * `aaaa-mm-dd` de un `<input type="date">` → instante ISO completo.
 *
 * El backend normaliza la fecha en el servicio (`new Date(...)`), así que la forma
 * corta también funcionaría; se envía el instante completo para no depender del
 * parseo del servidor.
 */
export function deInputFecha(valor: string): string | null {
  if (!valor) return null
  return `${valor}T00:00:00.000Z`
}

/** Instante ISO → `aaaa-mm-dd` para un `<input type="date">` (en UTC). */
export function paraInputFecha(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${mes}-${dia}`
}

/** `aaaa-mm-dd` de HOY en la hora local del usuario (para «ir a hoy»). */
export function hoyLocal(): string {
  const d = new Date()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/** Suma días a una fecha `aaaa-mm-dd` (en UTC, para no desplazar el día). */
export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return fecha
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** `aaaa-mm-dd` → «lunes, 10 de marzo de 2026» (en UTC). */
export function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return fecha
  return d.toLocaleDateString('es-PE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Edad en años cumplidos, o `null` si no hay fecha de nacimiento válida.
 * El día de nacimiento se lee en UTC (como se guardó) y «hoy» es el día local.
 */
export function calcularEdad(fechaNac: string | null): number | null {
  if (!fechaNac) return null
  const nace = new Date(fechaNac)
  if (Number.isNaN(nace.getTime())) return null
  const hoy = new Date()
  let edad = hoy.getFullYear() - nace.getUTCFullYear()
  const m = hoy.getMonth() - nace.getUTCMonth()
  if (m < 0 || (m === 0 && hoy.getDate() < nace.getUTCDate())) edad--
  return edad >= 0 ? edad : null
}

/** «09:30» → «9:30 a. m.» para mostrar. */
export function hora12(hora: string): string {
  const [h, m] = hora.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return hora
  const sufijo = h < 12 ? 'a. m.' : 'p. m.'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${sufijo}`
}

/** Suma minutos a «HH:MM» y devuelve «HH:MM» (para calcular la hora de fin). */
export function sumarMinutos(hora: string, minutos: number): string {
  const [h, m] = hora.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return hora
  const total = (h * 60 + m + minutos + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
