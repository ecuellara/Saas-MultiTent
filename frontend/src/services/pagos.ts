import api from './api'

/**
 * Capa de dominio de pagos.
 *
 * Cierra el circuito de la agenda: cita realizada → cobro (total o parcial)
 * → abonos hasta saldar → anulación solo si queda saldo. Las reglas las impone
 * el backend (`PagosService`); aquí solo se ocultan acciones inválidas.
 */

export type EstadoPago = 'pendiente' | 'parcial' | 'pagado' | 'anulado'
export type TipoPago = 'ingreso' | 'egreso'

export interface Pago {
  id: string
  tenantId: string
  codigoRecibo: string
  tipo: TipoPago
  pacienteId: string | null
  citaId: string | null
  concepto: string
  /** Prisma `Decimal`: viaja como cadena. Nunca operar sin convertir. */
  montoTotal: string | number
  montoPagado: string | number
  saldo: string | number
  metodoPago: string | null
  estado: EstadoPago
  /** `@db.Date`: ISO a medianoche UTC (mostrar con `formatearFechaUTC`). */
  fecha: string
  observacion: string | null
  createdAt: string
}

export interface PagoDetalleEntrada {
  descripcion: string
  tratamientoId?: string
  cantidad: number
  precioUnit: number
}

export interface CuotaEntrada {
  nroCuota: number
  monto: number
  fechaVencimiento: string
}

export interface PagoEntrada {
  concepto: string
  tipo: TipoPago
  pacienteId?: string
  citaId?: string
  montoTotal: number
  montoPagado?: number
  metodoPago?: string
  fecha?: string
  observacion?: string
  detalles?: PagoDetalleEntrada[]
  cuotas?: CuotaEntrada[]
}

export interface AbonoEntrada {
  monto: number
  metodoPago?: string
  fecha?: string
}

export const METODOS_PAGO = ['efectivo', 'yape', 'plin', 'tarjeta', 'transferencia'] as const

export const ESTADOS_PAGO: Array<{ valor: EstadoPago; etiqueta: string; clase: string }> = [
  { valor: 'pendiente', etiqueta: 'Pendiente', clase: 'bg-warning/10 text-warning' },
  { valor: 'parcial', etiqueta: 'Parcial', clase: 'bg-primary/10 text-primary' },
  { valor: 'pagado', etiqueta: 'Pagado', clase: 'bg-success/10 text-success' },
  { valor: 'anulado', etiqueta: 'Anulado', clase: 'bg-error/10 text-error' },
]

export function etiquetaEstadoPago(estado: string): string {
  return ESTADOS_PAGO.find((e) => e.valor === estado)?.etiqueta ?? estado
}

export function claseEstadoPago(estado: string): string {
  return ESTADOS_PAGO.find((e) => e.valor === estado)?.clase ?? 'bg-background-soft text-muted'
}

/** Convierte un Decimal (cadena o número) a número finito. */
export function num(v: string | number | null | undefined): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/** S/ 120.00 con formato peruano. */
export function formatoMoneda(v: string | number | null | undefined): string {
  return `S/ ${num(v).toFixed(2)}`
}

export async function listarPagos(): Promise<Pago[]> {
  const { data } = await api.get<Pago[]>('/pagos')
  return data
}

export async function obtenerPago(id: string): Promise<Pago> {
  const { data } = await api.get<Pago>(`/pagos/${id}`)
  return data
}

export async function crearPago(dto: PagoEntrada): Promise<Pago> {
  const { data } = await api.post<Pago>('/pagos', dto)
  return data
}

export async function registrarAbono(id: string, dto: AbonoEntrada): Promise<Pago> {
  const { data } = await api.post<Pago>(`/pagos/${id}/abonos`, dto)
  return data
}

export async function anularPago(id: string): Promise<Pago> {
  const { data } = await api.patch<Pago>(`/pagos/${id}/anular`)
  return data
}
