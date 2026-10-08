import api from './api'

/**
 * Capa de dominio de insumos (stock).
 *
 * El stock NUNCA se edita directo: se mueve con entradas/salidas atómicas del
 * servidor (`POST /insumos/:id/entradas|salidas`), que registran el movimiento.
 * `PATCH /insumos/:id` no existe a propósito (devuelve 400).
 */

export interface Insumo {
  id: string
  tenantId: string
  sedeId: string
  nombre: string
  unidad: string
  /** Prisma `Int`: viaja como número. */
  stockActual: number
  stockMinimo: number
  /** Prisma `Decimal`: viaja como cadena. */
  precioRef: string | number | null
  activo: boolean
  createdAt: string
}

export interface InsumoEntrada {
  nombre: string
  sedeId?: string
  unidad?: string
  stockMinimo?: number
  stockActual?: number
}

export interface MovimientoEntrada {
  cantidad: number
  motivo?: string
}

/** Unidades habituales (texto libre en el servidor). */
export const UNIDADES = ['und', 'caja', 'ml', 'par', 'blíster', 'frasco', 'kit'] as const

/** Aviso de stock bajo mínimo (solo visual; el servidor no bloquea salidas con stock suficiente). */
export function bajoMinimo(i: Insumo): boolean {
  return i.stockActual <= i.stockMinimo
}

export async function listarInsumos(): Promise<Insumo[]> {
  const { data } = await api.get<Insumo[]>('/insumos')
  return data
}

export async function obtenerInsumo(id: string): Promise<Insumo> {
  const { data } = await api.get<Insumo>(`/insumos/${id}`)
  return data
}

export async function crearInsumo(dto: InsumoEntrada): Promise<Insumo> {
  const { data } = await api.post<Insumo>('/insumos', dto)
  return data
}

export async function registrarEntrada(id: string, dto: MovimientoEntrada): Promise<Insumo> {
  const { data } = await api.post<Insumo>(`/insumos/${id}/entradas`, dto)
  return data
}

export async function registrarSalida(id: string, dto: MovimientoEntrada): Promise<Insumo> {
  const { data } = await api.post<Insumo>(`/insumos/${id}/salidas`, dto)
  return data
}
