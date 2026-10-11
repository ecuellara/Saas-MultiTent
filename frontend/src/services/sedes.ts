import api from './api'

/**
 * Capa de dominio de sedes.
 *
 * `GET /sedes` está abierto a propósito (los formularios de agenda lo
 * necesitan sin permiso de gestión); crear y editar exigen `sedes.manage`
 * en el servidor. La edición es parcial: lo que no se envía no se toca
 * (los blancos del formulario viajan como `undefined`, no como cadena).
 */

export interface Sede {
  id: string
  tenantId: string
  nombre: string
  direccion: string | null
  telefono: string | null
  esPrincipal: boolean
  activo: boolean
  createdAt: string
  deletedAt: string | null
}

export interface NuevaSede {
  nombre: string
  direccion?: string
  telefono?: string
  esPrincipal?: boolean
}

export interface SedeParcial {
  nombre?: string
  direccion?: string | null
  telefono?: string | null
  activo?: boolean
}

export async function listarSedes(): Promise<Sede[]> {
  const { data } = await api.get<Sede[]>('/sedes')
  return data
}

export async function crearSede(dto: NuevaSede): Promise<Sede> {
  const { data } = await api.post<Sede>('/sedes', dto)
  return data
}

export async function actualizarSede(id: string, dto: SedeParcial): Promise<Sede> {
  const { data } = await api.patch<Sede>(`/sedes/${id}`, dto)
  return data
}
