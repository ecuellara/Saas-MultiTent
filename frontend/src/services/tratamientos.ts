import api from './api'
import type { Tratamiento } from './catalogos'

export interface Especialidad {
  id: string
  nombre: string
  descripcion: string | null
  activo: boolean
}

export interface TratamientoEntrada {
  nombre: string
  descripcion?: string
  especialidadId?: string
  precio: number
  duracionMin?: number
}

export interface TratamientoActualizacion extends Partial<TratamientoEntrada> {
  activo?: boolean
}

export async function listarEspecialidades(): Promise<Especialidad[]> {
  const { data } = await api.get<Especialidad[]>('/especialidades')
  return data
}

export async function crearEspecialidad(dto: { nombre: string; descripcion?: string }): Promise<Especialidad> {
  const { data } = await api.post<Especialidad>('/especialidades', dto)
  return data
}

export async function crearTratamiento(dto: TratamientoEntrada): Promise<Tratamiento> {
  const { data } = await api.post<Tratamiento>('/tratamientos', dto)
  return data
}

export async function actualizarTratamiento(id: string, dto: TratamientoActualizacion): Promise<Tratamiento> {
  const { data } = await api.patch<Tratamiento>(`/tratamientos/${id}`, dto)
  return data
}
