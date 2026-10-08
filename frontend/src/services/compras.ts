import api from './api'

/**
 * Capa de dominio de compras.
 *
 * Registrar una compra ya incrementa el stock y crea el `Pago` de egreso en la
 * misma transacción del servidor: aquí solo se envían las líneas, el total lo
 * calcula el backend (lo mostrado es informativo).
 */

export interface CompraDetalle {
  id: string
  tenantId: string
  compraId: string
  insumoId: string
  cantidad: number
  /** Prisma `Decimal`: viaja como cadena. */
  precioUnit: string | number
  subtotal: string | number
}

export interface Compra {
  id: string
  tenantId: string
  proveedorId: string
  sedeId: string | null
  codigo: string | null
  /** `@db.Date`: ISO a medianoche UTC (mostrar con `formatearFechaUTC`). */
  fecha: string
  montoTotal: string | number
  estado: string
  observacion: string | null
  usuarioId: string | null
  createdAt: string
  detalles?: CompraDetalle[]
}

export interface LineaCompraEntrada {
  insumoId: string
  cantidad: number
  precioUnit: number
}

export interface CompraEntrada {
  proveedorId: string
  sedeId?: string
  fecha: string
  observacion?: string
  detalles: LineaCompraEntrada[]
}

/** Total informativo de las líneas (el servidor recalcula el definitivo). */
export function totalLineas(detalles: Array<{ cantidad: number; precioUnit: number }>): number {
  return detalles.reduce((s, d) => s + d.cantidad * d.precioUnit, 0)
}

export async function listarCompras(): Promise<Compra[]> {
  const { data } = await api.get<Compra[]>('/compras')
  return data
}

export async function obtenerCompra(id: string): Promise<Compra> {
  const { data } = await api.get<Compra>(`/compras/${id}`)
  return data
}

export async function crearCompra(dto: CompraEntrada): Promise<Compra> {
  const { data } = await api.post<Compra>('/compras', dto)
  return data
}
