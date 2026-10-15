/**
 * Conversión fecha/hora de la agenda a UTC y enlace «Añadir a Google Calendar».
 *
 * ÚNICA conversión del frontend: la usa tanto el botón por cita como cualquier
 * otro consumidor. Replica la del backend (`calendario-ics.ts`): fecha civil
 * `aaaa-mm-dd` (medianoche UTC) + hora `HH:MM` interpretada en hora de la
 * clínica.
 */

/**
 * Desplazamiento fijo de la clínica: America/Lima = UTC-5 SIN horario de
 * verano. Un offset constante es correcto aquí; si la clínica cambiara de zona
 * habría que sustituirlo por una conversión con zona horaria real.
 */
export const DESPLAZAMIENTO_LIMA_MINUTOS = -5 * 60

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/** Instante UTC de una cita a partir de su fecha civil y su hora en Lima. */
export function citaLimaAUtc(fecha: string, hora: string): Date {
  if (!HORA.test(hora)) throw new Error(`Hora inválida para el calendario: ${hora}`)
  const d = new Date(`${fecha}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) throw new Error('Fecha inválida para el calendario')
  const [hh, mm] = hora.split(':').map(Number) as [number, number]
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm) -
      DESPLAZAMIENTO_LIMA_MINUTOS * 60_000,
  )
}

/** `Date` → `AAAAMMDDTHHMMSSZ` (formato UTC de Google Calendar y del ICS). */
export function aUtcCompacto(instante: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `${instante.getUTCFullYear()}${p(instante.getUTCMonth() + 1)}${p(instante.getUTCDate())}` +
    `T${p(instante.getUTCHours())}${p(instante.getUTCMinutes())}${p(instante.getUTCSeconds())}Z`
  )
}

export interface EventoCalendario {
  titulo: string
  /** Fecha civil `aaaa-mm-dd` de inicio. */
  fecha: string
  /** `HH:MM` de inicio (hora de Lima). */
  horaInicio: string
  /** `HH:MM` de fin (hora de Lima). */
  horaFin: string
  sede?: string | null
  detalle?: string | null
}

/**
 * Enlace «Añadir a Google Calendar» para UNA cita.
 *
 * Se construye 100 % en el cliente, sin backend, sin API y sin claves: abre el
 * formulario de Google con los datos ya rellenos para que el odontólogo o el
 * paciente la añadan a su calendario personal.
 */
export function enlaceGoogleCalendar(evento: EventoCalendario): string {
  const inicio = aUtcCompacto(citaLimaAUtc(evento.fecha, evento.horaInicio))
  const fin = aUtcCompacto(citaLimaAUtc(evento.fecha, evento.horaFin))
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: evento.titulo,
    dates: `${inicio}/${fin}`,
  })
  if (evento.sede) params.set('location', evento.sede)
  if (evento.detalle) params.set('details', evento.detalle)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
