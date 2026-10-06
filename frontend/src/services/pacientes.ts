import api from './api'

/**
 * Capa de dominio de pacientes.
 *
 * Existe para que las vistas no llamen a `api.*` directamente (doc §5): así el
 * contrato con el backend vive en un solo archivo y un cambio de endpoint no
 * obliga a tocar plantillas.
 */

export interface Paciente {
  id: string
  tenantId: string
  tipoDoc: string
  numDoc: string | null
  nombres: string
  apellidos: string
  fechaNac: string | null
  sexo: string | null
  grupoSanguineo: string | null
  telefono: string | null
  email: string | null
  direccion: string | null
  ubigeoCodigo: string | null
  contactoEmergenciaNombre: string | null
  contactoEmergenciaTelefono: string | null
  representanteNombre: string | null
  representanteDni: string | null
  representanteDomicilio: string | null
  representanteParentesco: string | null
  alergias: string | null
  enfermedades: string | null
  medicamentos: string | null
  habitos: string | null
  antecedentes: string | null
  activo: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/** Campos que el usuario puede enviar al crear o editar. */
export type PacienteEntrada = Partial<
  Omit<Paciente, 'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'deletedAt'>
>

export interface DocumentoPaciente {
  id: string
  pacienteId: string
  nombreArchivo: string
  tipo: string
  mimeType: string
  tamanioKb: number | null
  createdAt: string
}

export interface HistorialClinico {
  id: string
  pacienteId: string
  citaId: string | null
  /** `@db.Date`: llega como ISO a medianoche UTC. */
  fecha: string
  hora: string | null
  motivo: string
  sintomas: string | null
  diagnostico: string | null
  tratamientoRealizado: string | null
  prescripcion: string | null
  createdAt: string
}

export interface Odontograma {
  id: string
  pacienteId: string
  tipo: string
  version: number
  estado: string
  piezas: unknown
  observaciones: string | null
  fecha: string
  firmadoPor: string | null
  firmadoEn: string | null
  createdAt: string
}

/**
 * Tipos admitidos al SUBIR el archivo. Debe coincidir con la allowlist del
 * backend (`TIPOS_DOCUMENTO` en `pacientes.service.ts`): si se desincroniza, el
 * usuario ve un 400 al subir.
 */
export const TIPOS_DOCUMENTO = [
  { valor: 'RX_PANORAMICA', etiqueta: 'Radiografía panorámica' },
  { valor: 'RX_PERIAPICAL', etiqueta: 'Radiografía periapical' },
  { valor: 'FOTO', etiqueta: 'Fotografía clínica' },
  { valor: 'CONSENTIMIENTO', etiqueta: 'Consentimiento' },
  { valor: 'RECETA', etiqueta: 'Receta' },
  { valor: 'INFORME', etiqueta: 'Informe' },
  { valor: 'OTRO', etiqueta: 'Otro' },
] as const

export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number]['valor']

export function etiquetaTipoDocumento(tipo: string): string {
  return TIPOS_DOCUMENTO.find((t) => t.valor === tipo)?.etiqueta ?? tipo
}

export async function listarPacientes(limit = 100): Promise<Paciente[]> {
  const { data } = await api.get<Paciente[]>('/pacientes', { params: { limit } })
  return data
}

export async function obtenerPaciente(id: string): Promise<Paciente> {
  const { data } = await api.get<Paciente>(`/pacientes/${id}`)
  return data
}

export async function crearPaciente(dto: PacienteEntrada): Promise<Paciente> {
  const { data } = await api.post<Paciente>('/pacientes', dto)
  return data
}

export async function actualizarPaciente(id: string, dto: PacienteEntrada): Promise<Paciente> {
  const { data } = await api.patch<Paciente>(`/pacientes/${id}`, dto)
  return data
}

export async function eliminarPaciente(id: string): Promise<void> {
  await api.delete(`/pacientes/${id}`)
}

export async function listarHistoriales(pacienteId: string): Promise<HistorialClinico[]> {
  const { data } = await api.get<HistorialClinico[]>(`/pacientes/${pacienteId}/historiales`)
  return data
}

export async function listarDocumentos(pacienteId: string): Promise<DocumentoPaciente[]> {
  const { data } = await api.get<DocumentoPaciente[]>(`/pacientes/${pacienteId}/documentos`)
  return data
}

export async function listarOdontogramas(pacienteId: string): Promise<Odontograma[]> {
  const { data } = await api.get<Odontograma[]>(`/pacientes/${pacienteId}/odontogramas`)
  return data
}

/**
 * Sube el archivo de un documento. Es `multipart`, y el tipo viaja como campo
 * del formulario: la **clave** y el **MIME real** los decide el servidor a
 * partir del contenido, no el cliente.
 */
export async function subirDocumento(
  pacienteId: string,
  archivo: File,
  tipo: TipoDocumento,
): Promise<DocumentoPaciente> {
  const cuerpo = new FormData()
  cuerpo.append('archivo', archivo)
  cuerpo.append('tipo', tipo)
  const { data } = await api.post<DocumentoPaciente>(
    `/pacientes/${pacienteId}/documentos/archivo`,
    cuerpo,
  )
  return data
}

/**
 * Descarga el binario y dispara el guardado en el navegador.
 *
 * Se pide como `blob` a propósito: el endpoint exige el token y valida la firma
 * del archivo, así que no puede resolverse con un `<a href>` directo (esa
 * petición no llevaría la cabecera de autorización).
 */
export async function descargarDocumento(
  pacienteId: string,
  docId: string,
  nombreArchivo: string,
): Promise<void> {
  const { data } = await api.get<Blob>(`/pacientes/${pacienteId}/documentos/${docId}/descarga`, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(data)
  try {
    const enlace = document.createElement('a')
    enlace.href = url
    enlace.download = nombreArchivo
    document.body.appendChild(enlace)
    enlace.click()
    enlace.remove()
  } finally {
    // Liberar el objeto URL: si no, el blob se queda en memoria hasta recargar.
    URL.revokeObjectURL(url)
  }
}

/** Formatea un INSTANTE ISO a `dd/mm/aaaa` en la hora del usuario. */
export function formatearFecha(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Formatea una FECHA SIN HORA (fecha de nacimiento, fecha clínica) en UTC.
 *
 * Estas columnas se guardan como un instante a medianoche UTC. Formatearlas en
 * hora local las mostraría **un día antes** en cualquier huso negativo (Lima es
 * UTC-5): el 09/03 guardado aparecería como 08/03.
 */
export function formatearFechaUTC(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * `aaaa-mm-dd` de un `<input type="date">` → instante ISO que Prisma acepta.
 *
 * Prisma **rechaza** la forma corta `2015-03-09` en un campo `DateTime` (responde
 * «Datos inválidos»), así que la conversión no es opcional. Se fija medianoche
 * UTC para que el día no se desplace, y se lee siempre con `formatearFechaUTC`.
 */
export function deInputFecha(valor: string): string | null {
  if (!valor) return null
  return `${valor}T00:00:00.000Z`
}

/**
 * Edad en años cumplidos, o `null` si no hay fecha de nacimiento válida.
 * El día de nacimiento se lee en UTC (como se guardó) y «hoy» es el día local.
 */
export function calcularEdad(fechaNac: string | null): number | null {
  if (!fechaNac) return null
  const nace = new Date(fechaNac)
  if (Number.isNaN(nace.getTime())) return null
  const hoy = new Date()
  let edad = hoy.getFullYear() - nace.getUTCFullYear()
  const m = hoy.getMonth() - nace.getUTCMonth()
  if (m < 0 || (m === 0 && hoy.getDate() < nace.getUTCDate())) edad--
  return edad >= 0 ? edad : null
}

/** `true` si el documento es una imagen que se puede previsualizar. */
export function esImagen(mimeType: string): boolean {
  return mimeType === 'image/png' || mimeType === 'image/jpeg'
}

/** Instante ISO → `aaaa-mm-dd` para un `<input type="date">` (en UTC). */
export function paraInputFecha(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const mes = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dia = String(d.getUTCDate()).padStart(2, '0')
  return `${d.getUTCFullYear()}-${mes}-${dia}`
}
