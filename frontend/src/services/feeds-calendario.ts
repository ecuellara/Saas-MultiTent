import api from './api'

/**
 * Feeds ICS suscribibles de la clínica.
 *
 * El backend expone la gestión en `/feeds-calendario` (con sesión y permiso de
 * agenda) y la descarga pública en `/api/agenda/:token.ics` (sin sesión: la
 * autenticación ES el token). Esta capa solo gestiona; la URL de suscripción
 * se construye aquí porque es mecánica.
 */

export interface FeedCalendario {
  id: string
  sedeId: string | null
  dentistaId: string | null
  /** Secreto: quien tenga la URL lo ve todo. Nunca se muestra salvo para copiar. */
  token: string
  activo: boolean
  createdAt: string
  updatedAt: string
}

export interface NuevoFeed {
  sedeId?: string | null
  dentistaId?: string | null
}

export async function listarFeeds(): Promise<FeedCalendario[]> {
  const { data } = await api.get<FeedCalendario[]>('/feeds-calendario')
  return data
}

export async function crearFeed(dto: NuevoFeed): Promise<FeedCalendario> {
  const { data } = await api.post<FeedCalendario>('/feeds-calendario', {
    ...(dto.sedeId ? { sedeId: dto.sedeId } : {}),
    ...(dto.dentistaId ? { dentistaId: dto.dentistaId } : {}),
  })
  return data
}

/** Revoca el token actual y entrega uno nuevo (la URL vieja deja de funcionar). */
export async function regenerarFeed(id: string): Promise<FeedCalendario> {
  const { data } = await api.post<FeedCalendario>(`/feeds-calendario/${id}/regenerar`)
  return data
}

export async function actualizarFeed(id: string, activo: boolean): Promise<FeedCalendario> {
  const { data } = await api.patch<FeedCalendario>(`/feeds-calendario/${id}`, { activo })
  return data
}

export async function eliminarFeed(id: string): Promise<void> {
  await api.delete(`/feeds-calendario/${id}`)
}

/**
 * URL absoluta de suscripción del feed.
 *
 * Relativa al origen actual (`/api` se proxya al backend tanto en desarrollo
 * como en Vercel), así el calendario la consulta siempre contra la API real.
 */
export function urlSuscripcionFeed(token: string): string {
  return `${window.location.origin}/api/agenda/${token}.ics`
}
