import api from './api'

/**
 * Capa de dominio de la configuración de la clínica.
 *
 * Formas que entiende el lector de agenda (`CitasService`); no inventar otras:
 * - `horario`: claves EXACTAS `dom..sab` (`mie`, no `mié`), cada valor `null`
 *   (cerrado) o `{ inicio, fin }` en `HH:MM` de 24 h. Un día omitido equivale
 *   a cerrado.
 * - `descansos`: `{ desde: 'YYYY-MM-DD', hasta?: ..., motivo?: ... }`; sin
 *   `hasta` cubre solo ese día.
 */

export type DiaSemana = 'dom' | 'lun' | 'mar' | 'mie' | 'jue' | 'vie' | 'sab'

export const DIAS_SEMANA: Array<{ clave: DiaSemana; etiqueta: string }> = [
  { clave: 'dom', etiqueta: 'Domingo' },
  { clave: 'lun', etiqueta: 'Lunes' },
  { clave: 'mar', etiqueta: 'Martes' },
  { clave: 'mie', etiqueta: 'Miércoles' },
  { clave: 'jue', etiqueta: 'Jueves' },
  { clave: 'vie', etiqueta: 'Viernes' },
  { clave: 'sab', etiqueta: 'Sábado' },
]

export interface Franja {
  inicio: string
  fin: string
}

export type Horario = Record<DiaSemana, Franja | null>

export interface Descanso {
  desde: string
  hasta?: string
  motivo?: string
}

export interface Configuracion {
  tenantId: string
  nombre: string
  ruc: string | null
  direccion: string | null
  telefono: string | null
  email: string | null
  ciudad: string
  horario: Horario | null
  descansos: Descanso[] | null
  logoUrl: string | null
  colores: unknown
}

export interface ConfiguracionEntrada {
  nombre?: string
  ruc?: string
  direccion?: string
  telefono?: string
  email?: string
  ciudad?: string
  logoUrl?: string
  horario?: Horario | null
  descansos?: Descanso[]
}

export async function obtenerConfiguracion(): Promise<Configuracion> {
  const { data } = await api.get<Configuracion>('/configuracion')
  return data
}

export async function actualizarConfiguracion(dto: ConfiguracionEntrada): Promise<Configuracion> {
  const { data } = await api.patch<Configuracion>('/configuracion', dto)
  return data
}

/** Resumen legible: «Lun–Vie 08:00–19:00 · Sáb 08:00–13:00 · Dom cerrado». */
export function resumirHorario(horario: Horario | null): string {
  if (!horario) return 'Sin horario configurado'
  const abiertas = (Object.keys(horario) as DiaSemana[]).filter((d) => horario[d] !== null)
  if (abiertas.length === 0) return 'Cerrado toda la semana'
  const grupos: Array<{ dias: DiaSemana[]; franja: Franja }> = []
  for (const d of abiertas) {
    const f = horario[d]!
    const ultimo = grupos[grupos.length - 1]
    if (ultimo && ultimo.franja.inicio === f.inicio && ultimo.franja.fin === f.fin) {
      ultimo.dias.push(d)
    } else {
      grupos.push({ dias: [d], franja: { inicio: f.inicio, fin: f.fin } })
    }
  }
  const nombre = (d: DiaSemana): string =>
    DIAS_SEMANA.find((x) => x.clave === d)?.etiqueta.slice(0, 3) ?? d
  const partes = grupos.map((g) => {
    const rango = g.dias.length > 1 ? `${nombre(g.dias[0]!)}–${nombre(g.dias[g.dias.length - 1]!)}` : nombre(g.dias[0]!)
    return `${rango} ${g.franja.inicio}–${g.franja.fin}`
  })
  const cerrados = (Object.keys(horario) as DiaSemana[]).filter((d) => horario[d] === null)
  if (cerrados.length > 0) {
    partes.push(`${cerrados.map(nombre).join(', ')} cerrado${cerrados.length > 1 ? 's' : ''}`)
  }
  return partes.join(' · ')
}
