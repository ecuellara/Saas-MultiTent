import api from './api'

/**
 * Catálogos que alimentan los formularios (tratamientos, sedes y equipo).
 *
 * Los dos primeros se pueden leer con cualquier usuario autenticado; el equipo
 * exige `members.manage`, así que el selector de odontólogo solo se muestra a
 * quien puede listarlo (ver `CitaFormModal`).
 */

export interface Tratamiento {
  id: string
  nombre: string
  descripcion: string | null
  /**
   * Prisma `Decimal`: **viaja como cadena** (`"120"`), no como número. Se
   * convierte con `Number(...)` al mostrarlo o al calcular.
   */
  precio: string
  duracionMin: number
  activo: boolean
  especialidadId: string | null
}

export interface Sede {
  id: string
  nombre: string
  esPrincipal?: boolean
}

export interface Miembro {
  id: string
  userId: string
  roleId: string
  sedeId: string | null
  estado: string
  user: { id: string; email: string; nombre: string }
  role: { id: string; codigo: string; nombre: string }
}

export async function listarTratamientos(): Promise<Tratamiento[]> {
  const { data } = await api.get<Tratamiento[]>('/tratamientos')
  return data
}

export async function listarSedes(): Promise<Sede[]> {
  const { data } = await api.get<Sede[]>('/sedes')
  return data
}

/** Requiere `members.manage` en el backend. */
export async function listarMiembros(): Promise<Miembro[]> {
  const { data } = await api.get<Miembro[]>('/memberships')
  return data
}

/** Precio de un tratamiento como número (llega como cadena desde Prisma). */
export function precioDe(t: Tratamiento): number {
  const n = Number(t.precio)
  return Number.isFinite(n) ? n : 0
}
