import api from './api'

/**
 * Capa de dominio de la agenda (citas).
 *
 * Reglas del backend que el frontend NO debe duplicar pero sí anticipar para dar
 * buenos mensajes: el rango horario (`horaFin` > `horaInicio`), el horario de
 * atención y los descansos del consultorio, y el solapamiento por sede o por
 * odontólogo. Todas devuelven un mensaje explicativo, así que la vista se limita
 * a mostrarlo.
 */

export type EstadoCita =
  | 'pendiente'
  | 'confirmada'
  | 'recordatorio_enviado'
  | 'reprogramada'
  | 'cancelada'
  | 'realizada'
  | 'no_asistio'

export interface Cita {
  id: string
  tenantId: string
  token: string
  pacienteId: string
  tratamientoId: string | null
  sedeId: string | null
  dentistaId: string | null
  /** `@db.Date`: llega como ISO a medianoche UTC. Se muestra con `formatearFechaUTC`. */
  fecha: string
  horaInicio: string
  horaFin: string
  estado: EstadoCita
  observacion: string | null
  createdAt: string
}

export interface CitaEntrada {
  pacienteId: string
  tratamientoId?: string | null
  sedeId?: string | null
  dentistaId?: string | null
  /** `aaaa-mm-dd` */
  fecha: string
  /** `HH:MM` */
  horaInicio: string
  /** `HH:MM` */
  horaFin: string
  observacion?: string | null
}

export interface CitaActualizacion {
  fecha?: string
  horaInicio?: string
  horaFin?: string
  estado?: EstadoCita
  observacion?: string | null
  tratamientoId?: string | null
}

/** Estados con su etiqueta y su color de Badge (una sola fuente). */
export const ESTADOS_CITA: Array<{ valor: EstadoCita; etiqueta: string; clase: string }> = [
  { valor: 'pendiente', etiqueta: 'Pendiente', clase: 'bg-warning/15 text-warning' },
  { valor: 'confirmada', etiqueta: 'Confirmada', clase: 'bg-primary/15 text-primary' },
  {
    valor: 'recordatorio_enviado',
    etiqueta: 'Recordatorio enviado',
    clase: 'bg-primary/15 text-primary',
  },
  { valor: 'reprogramada', etiqueta: 'Reprogramada', clase: 'bg-warning/15 text-warning' },
  { valor: 'realizada', etiqueta: 'Realizada', clase: 'bg-success/15 text-success' },
  { valor: 'cancelada', etiqueta: 'Cancelada', clase: 'bg-error/15 text-error' },
  { valor: 'no_asistio', etiqueta: 'No asistió', clase: 'bg-error/15 text-error' },
]

export function etiquetaEstado(estado: string): string {
  return ESTADOS_CITA.find((e) => e.valor === estado)?.etiqueta ?? estado
}

export function claseEstado(estado: string): string {
  return ESTADOS_CITA.find((e) => e.valor === estado)?.clase ?? 'bg-background-soft text-muted'
}

/** Citas de un día (`aaaa-mm-dd`); sin fecha, devuelve todas. */
export async function listarCitas(fecha?: string): Promise<Cita[]> {
  const { data } = await api.get<Cita[]>('/citas', { params: fecha ? { fecha } : {} })
  return data
}

export async function obtenerCita(id: string): Promise<Cita> {
  const { data } = await api.get<Cita>(`/citas/${id}`)
  return data
}

export async function crearCita(dto: CitaEntrada): Promise<Cita> {
  const { data } = await api.post<Cita>('/citas', dto)
  return data
}

export async function actualizarCita(id: string, dto: CitaActualizacion): Promise<Cita> {
  const { data } = await api.patch<Cita>(`/citas/${id}`, dto)
  return data
}

/** Cambia el estado a `cancelada` (no borra la cita). */
export async function cancelarCita(id: string): Promise<Cita> {
  const { data } = await api.patch<Cita>(`/citas/${id}/cancelar`)
  return data
}
