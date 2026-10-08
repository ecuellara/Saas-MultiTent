import api from './api'

/** Capa de dominio de proveedores. */

export interface Proveedor {
  id: string
  tenantId: string
  ruc: string | null
  nombre: string
  contacto: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  activo: boolean
  createdAt: string
}

export interface ProveedorEntrada {
  nombre: string
  ruc?: string
  contacto?: string
  telefono?: string
  email?: string
  direccion?: string
}

export async function listarProveedores(): Promise<Proveedor[]> {
  const { data } = await api.get<Proveedor[]>('/proveedores')
  return data
}

export async function obtenerProveedor(id: string): Promise<Proveedor> {
  const { data } = await api.get<Proveedor>(`/proveedores/${id}`)
  return data
}

export async function crearProveedor(dto: ProveedorEntrada): Promise<Proveedor> {
  const { data } = await api.post<Proveedor>('/proveedores', dto)
  return data
}

export async function actualizarProveedor(id: string, dto: Partial<ProveedorEntrada>): Promise<Proveedor> {
  const { data } = await api.patch<Proveedor>(`/proveedores/${id}`, dto)
  return data
}
