import api from './api'

/**
 * Capa de dominio de roles y del catálogo de permisos.
 *
 * El catálogo (`codigo`, `recurso`, `accion`) lo expone el backend desde su
 * fuente única: aquí no se duplica la lista (si la norma de permisos crece,
 * la paleta la sigue sin editar este archivo).
 */

export interface Permiso {
  codigo: string
  recurso: string
  accion: string
}

export interface PermisoDeRol {
  permission: Permiso & { id: string }
}

export interface Rol {
  id: string
  tenantId: string
  codigo: string
  nombre: string
  esSistema: boolean
  permisos: PermisoDeRol[]
}

export function codigosDeRol(rol: Rol): string[] {
  return rol.permisos.map((p) => p.permission.codigo)
}

/** Catálogo agrupado por recurso, en el orden en que lo sirve el backend. */
export function agruparPermisosPorRecurso(catalogo: Permiso[]): Array<{ recurso: string; permisos: Permiso[] }> {
  const grupos = new Map<string, Permiso[]>()
  for (const p of catalogo) {
    const lista = grupos.get(p.recurso) ?? []
    lista.push(p)
    grupos.set(p.recurso, lista)
  }
  return [...grupos.entries()].map(([recurso, permisos]) => ({ recurso, permisos }))
}

export async function listarRoles(): Promise<Rol[]> {
  const { data } = await api.get<Rol[]>('/roles')
  return data
}

export async function listarCatalogoPermisos(): Promise<Permiso[]> {
  const { data } = await api.get<Permiso[]>('/roles/permisos')
  return data
}

export async function crearRol(dto: { codigo: string; nombre: string }): Promise<Rol> {
  const { data } = await api.post<Rol>('/roles', dto)
  return data
}

export async function asignarPermisos(rolId: string, codigos: string[]): Promise<Rol> {
  const { data } = await api.patch<Rol>(`/roles/${rolId}/permisos`, { codigos })
  return data
}
