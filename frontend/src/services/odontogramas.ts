import api from './api'
import { deInputFecha } from './fechas'
import type { Odontograma } from './pacientes'

/**
 * Capa de dominio del odontograma (NTS 188).
 *
 * El ciclo real vive en la ficha del paciente (`OdontogramasPanel`) y en la
 * pantalla `/odontograma`: crear una versión, registrar hallazgos desde la
 * paleta del catálogo, anularlos (anular ≠ borrar) y firmar la versión.
 *
 * REGLAS QUE ESTA CAPA RESPETA (el servidor las valida; aquí no se provoca
 * un 400 evitable):
 * - `alcance: 'pieza'` → NO se envían superficies.
 * - `requiereSuperficie: true` → se exige al menos una superficie marcada.
 * - `requiereMaterial: true` → se exige el material antes de añadir.
 * - NUNCA se envían `estadoClinico` ni `color`: el servidor los deriva del
 *   catálogo (el whitelist los rechazaría con 400).
 */

export type AlcanceHallazgo = 'superficie' | 'pieza'

export interface HallazgoCatalogo {
  codigo: string
  nombre: string
  abreviatura: string
  alcance: AlcanceHallazgo
  requiereSuperficie: boolean
  requiereMaterial: boolean
  colorDefecto: string
}

export interface OdontogramaHallazgo {
  id: string
  odontogramaId: string
  pieza: string
  hallazgoCodigo: string
  superficies: string[]
  estadoClinico: string
  color: string
  material: string | null
  tratamientoId: string | null
  citaId: string | null
  activo: boolean
  createdAt: string
}

export interface OdontogramaEvento {
  id: string
  odontogramaId: string
  pieza: string
  estadoAnterior: string | null
  estadoNuevo: string
  tratamientoId: string | null
  citaId: string | null
  fecha: string
  observacion: string | null
}

export interface OdontogramaDetalle extends Odontograma {
  hallazgos: OdontogramaHallazgo[]
  eventos: OdontogramaEvento[]
}

export interface NuevoOdontograma {
  pacienteId: string
  /** Fecha del `<input type="date">` (`aaaa-mm-dd`): se envía en UTC. */
  fechaInput: string
  tipo?: string
  piezas?: Record<string, unknown>
  observaciones?: string
}

export interface NuevoHallazgo {
  pieza: string
  hallazgoCodigo: string
  superficies?: string[]
  material?: string
  tratamientoId?: string
  citaId?: string
}

export async function listarCatalogoHallazgos(): Promise<HallazgoCatalogo[]> {
  const { data } = await api.get<HallazgoCatalogo[]>('/odontogramas/catalogo')
  return data
}

export async function obtenerOdontograma(id: string): Promise<OdontogramaDetalle> {
  const { data } = await api.get<OdontogramaDetalle>(`/odontogramas/${id}`)
  return data
}

export async function crearOdontograma(dto: NuevoOdontograma): Promise<Odontograma> {
  // `@db.Date`: la fecha viaja como medianoche UTC (ver `fechas.ts`).
  const fecha = deInputFecha(dto.fechaInput)
  if (!fecha) throw new Error('Fecha inválida (se espera aaaa-mm-dd)')
  const { data } = await api.post<Odontograma>('/odontogramas', {
    pacienteId: dto.pacienteId,
    tipo: dto.tipo ?? 'inicial',
    fecha,
    // El JSON `piezas` solo se envía al crear; la fuente de verdad al pintar
    // son los `hallazgos` (tienen traza y anulación).
    piezas: dto.piezas ?? {},
    observaciones: dto.observaciones ?? undefined,
  })
  return data
}

export async function agregarHallazgo(
  odontogramaId: string,
  dto: NuevoHallazgo,
): Promise<OdontogramaHallazgo> {
  const { data } = await api.post<OdontogramaHallazgo>(`/odontogramas/${odontogramaId}/hallazgos`, dto)
  return data
}

export async function anularHallazgo(
  odontogramaId: string,
  hallazgoId: string,
): Promise<OdontogramaHallazgo> {
  const { data } = await api.patch<OdontogramaHallazgo>(
    `/odontogramas/${odontogramaId}/hallazgos/${hallazgoId}/anular`,
  )
  return data
}

export async function firmarOdontograma(id: string): Promise<Odontograma> {
  const { data } = await api.patch<Odontograma>(`/odontogramas/${id}/firmar`)
  return data
}
