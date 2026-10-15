import api from './api'

export { EJEMPLO_MARCADORES, sustituirMarcadores, vistaPrevia } from './plantillas-marcadores'

/**
 * Plantillas de notificación (WhatsApp MANUAL vía `wa.me`, sin API de Meta).
 *
 * El backend guarda los textos por clínica; el mensaje se compone AQUÍ
 * sustituyendo marcadores. `sustituirMarcadores` es el espejo de la función
 * del backend (`core/catalogo/plantillas.ts`): sustitución simple de
 * `{{marcador}}`, sin motor de plantillas.
 */

export interface PlantillaVista {  clave: string
  nombre: string
  texto: string
  activo: boolean
  esDefecto: boolean
  marcadores: string[]
}

export interface PlantillasRespuesta {
  plantillas: PlantillaVista[]
  marcadores: Record<string, string>
}

export async function listarPlantillas(): Promise<PlantillasRespuesta> {
  const { data } = await api.get<PlantillasRespuesta>('/plantillas-whatsapp')
  return data
}

export async function actualizarPlantilla(
  clave: string,
  dto: { texto?: string; activo?: boolean },
): Promise<PlantillaVista> {
  const { data } = await api.patch<PlantillaVista>(`/plantillas-whatsapp/${clave}`, dto)
  return data
}

export async function restaurarPlantilla(clave: string): Promise<PlantillaVista> {
  const { data } = await api.post<PlantillaVista>(`/plantillas-whatsapp/${clave}/restaurar`)
  return data
}
