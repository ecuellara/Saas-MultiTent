import api from './api'

/**
 * Capa de dominio de consentimientos informados.
 *
 * El ciclo real vive en la ficha del paciente (`ConsentimientosPanel`): crear
 * en borrador desde una plantilla, adjuntar la firma manuscrita y recién
 * entonces marcar como firmado. La pantalla `/consentimientos` solo gestiona
 * plantillas y altas.
 */

export type EstadoConsentimiento = 'borrador' | 'firmado' | 'revocado' | 'anulado'
export type RolFirma = 'paciente' | 'odontologo'

export interface Plantilla {
  id: string
  tenantId: string
  clave: string
  titulo: string
  cuerpo: string
  activo: boolean
}

export interface Consentimiento {
  id: string
  tenantId: string
  pacienteId: string
  plantillaId: string
  citaId: string | null
  tratamiento: string | null
  datosSnapshot: Record<string, unknown>
  /** Texto congelado al crear: lo que el paciente vio, aunque cambie la plantilla. */
  cuerpoSnapshot: string | null
  estado: EstadoConsentimiento
  firmadoEn: string | null
  revocadoEn: string | null
  revocadoPor: string | null
  createdAt: string
  plantilla?: { id: string; titulo: string; clave: string }
}

export interface ConsentimientoListado {
  id: string
  tenantId: string
  pacienteId: string
  plantillaId: string
  citaId: string | null
  tratamiento: string | null
  estado: EstadoConsentimiento
  firmadoEn: string | null
  revocadoEn: string | null
  createdAt: string
  plantilla?: { id: string; titulo: string; clave: string }
}

export interface ConsentimientoEntrada {
  pacienteId: string
  plantillaId: string
  citaId?: string
  tratamiento?: string
  datosSnapshot: Record<string, unknown>
}

export const ESTADOS_CONSENTIMIENTO: Array<{ valor: EstadoConsentimiento; etiqueta: string; clase: string }> = [
  { valor: 'borrador', etiqueta: 'Borrador', clase: 'bg-warning/10 text-warning' },
  { valor: 'firmado', etiqueta: 'Firmado', clase: 'bg-success/10 text-success' },
  { valor: 'revocado', etiqueta: 'Revocado', clase: 'bg-error/10 text-error' },
  { valor: 'anulado', etiqueta: 'Anulado', clase: 'bg-background-soft text-muted' },
]

export function etiquetaEstadoConsentimiento(estado: string): string {
  return ESTADOS_CONSENTIMIENTO.find((e) => e.valor === estado)?.etiqueta ?? estado
}

export function claseEstadoConsentimiento(estado: string): string {
  return ESTADOS_CONSENTIMIENTO.find((e) => e.valor === estado)?.clase ?? 'bg-background-soft text-muted'
}

export async function listarPlantillas(): Promise<Plantilla[]> {
  const { data } = await api.get<Plantilla[]>('/consentimientos/plantillas')
  return data
}

export async function crearPlantilla(dto: { clave: string; titulo: string; cuerpo: string }): Promise<Plantilla> {
  const { data } = await api.post<Plantilla>('/consentimientos/plantillas', dto)
  return data
}

export async function listarPorPaciente(pacienteId: string): Promise<ConsentimientoListado[]> {
  const { data } = await api.get<ConsentimientoListado[]>('/consentimientos', {
    params: { pacienteId },
  })
  return data
}

export async function obtenerConsentimiento(id: string): Promise<Consentimiento> {
  const { data } = await api.get<Consentimiento>(`/consentimientos/${id}`)
  return data
}

export async function crearConsentimiento(dto: ConsentimientoEntrada): Promise<Consentimiento> {
  const { data } = await api.post<Consentimiento>('/consentimientos', dto)
  return data
}

export async function cambiarEstadoConsentimiento(id: string, estado: EstadoConsentimiento): Promise<Consentimiento> {
  const { data } = await api.patch<Consentimiento>(`/consentimientos/${id}/estado`, { estado })
  return data
}

export async function subirFirma(id: string, rol: RolFirma, imagen: Blob): Promise<unknown> {
  const cuerpo = new FormData()
  cuerpo.append('archivo', imagen, 'firma.png')
  cuerpo.append('rol', rol)
  const { data } = await api.post(`/consentimientos/${id}/firmas`, cuerpo)
  return data
}

/**
 * Descarga la imagen de la firma como `blob` (para `<img>` o descarga).
 *
 * Se pide por axios a propósito: el endpoint exige el token y no se puede
 * resolver con un `<img src>` directo (esa petición no llevaría autorización).
 */
export async function descargarFirma(id: string, rol: RolFirma): Promise<Blob> {
  const { data } = await api.get<Blob>(`/consentimientos/${id}/firmas/${rol}`, {
    responseType: 'blob',
  })
  return data
}
