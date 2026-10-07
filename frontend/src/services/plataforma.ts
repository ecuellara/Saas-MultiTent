import axios, { type AxiosError } from 'axios'

/**
 * Cliente del PANEL DE PLATAFORMA. Instancia separada de `api.ts` a propósito:
 * - Token propio (`platform_token`, nunca el de clínica).
 * - Sin cabecera `X-Tenant-Id`: las rutas de plataforma van con
 *   `PlatformGuard`, no con `TenantGuard` (invariante 1).
 */

const TOKEN_KEY = 'platform_token'

const plataforma = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
  withCredentials: true,
})

plataforma.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

plataforma.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    const status = err.response?.status
    if (status === 401 && err.config?.silencioso !== true) {
      localStorage.removeItem(TOKEN_KEY)
      window.dispatchEvent(new Event('plataforma:expirada'))
    }
    return Promise.reject(err)
  },
)

export function leerTokenPlataforma(): string {
  return localStorage.getItem(TOKEN_KEY) ?? ''
}

export function guardarTokenPlataforma(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function quitarTokenPlataforma(): void {
  localStorage.removeItem(TOKEN_KEY)
}

/** Respuesta del login: sesión plena, MFA pendiente o alta de MFA. */
export type LoginPlataforma =
  | { access_token: string }
  | { mfa_required: true; temp_token: string }
  | { mfa_required: true; mfa_setup_required: true; temp_token: string }

export interface ClinicaResumen {
  id: string
  slug: string
  nombre: string
  razonSocial: string | null
  estado: 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'
  suscripcion: {
    estado: string
    planId: string
    periodoFin: string
    plan?: { codigo: string; nombre: string }
  } | null
}

export interface ClinicaAlta {
  slug: string
  nombre: string
  razonSocial?: string
  planCodigo: string
  sedeNombre?: string
  ownerNombre: string
  ownerEmail: string
  ownerPassword: string
  ownerCop?: string
}

export interface ClinicaCreada {
  id: string
  slug: string
  nombre: string
  sede: { id: string; nombre: string }
  owner: { id: string; email: string }
  plan: string
}

export interface Plan {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  precioMensual: number
}

export interface MetricasClinica {
  tenantId: string
  pacientes: number
  citas: number
  pagosPendientes: number
  insumos: number
  usuarios: number
}

export interface ExportClinica {
  exportadoEn: string
  tenantId: string
  tablas: Record<string, unknown[]>
  conteos: Record<string, number>
}

export async function loginPlataforma(email: string, password: string): Promise<LoginPlataforma> {
  const { data } = await plataforma.post<LoginPlataforma>('/platform/auth/login', { email, password })
  return data
}

export async function mfaSetup(tempToken: string): Promise<{ secret: string; otpauth_url: string }> {
  const { data } = await plataforma.post(
    '/platform/auth/mfa/setup',
    {},
    { headers: { Authorization: `Bearer ${tempToken}` } },
  )
  return data
}

export async function mfaConfirm(tempToken: string, code: string): Promise<{ mfaEnabled: true }> {
  const { data } = await plataforma.post(
    '/platform/auth/mfa/confirm',
    { code },
    { headers: { Authorization: `Bearer ${tempToken}` } },
  )
  return data
}

export async function mfaVerify(tempToken: string, code: string): Promise<{ access_token: string }> {
  const { data } = await plataforma.post('/platform/auth/mfa/verify', {
    temp_token: tempToken,
    code,
  })
  return data
}

export async function cerrarSesionPlataforma(): Promise<void> {
  await plataforma.post('/platform/auth/logout', {}, { silencioso: true }).catch(() => undefined)
}

export async function listarClinicas(): Promise<ClinicaResumen[]> {
  const { data } = await plataforma.get<ClinicaResumen[]>('/platform/tenants')
  return data
}

export interface DetalleClinica extends ClinicaResumen {
  createdAt: string
  suscripcion: {
    estado: string
    planId: string
    periodoFin: string
    plan?: { codigo: string; nombre: string }
  } | null
  sedes: Array<{ id: string; nombre: string; esPrincipal: boolean }>
}

export async function obtenerClinica(id: string): Promise<DetalleClinica> {
  const { data } = await plataforma.get<DetalleClinica>(`/platform/tenants/${id}`)
  return data
}

export async function crearClinica(payload: ClinicaAlta): Promise<ClinicaCreada> {
  const { data } = await plataforma.post<ClinicaCreada>('/platform/tenants', payload)
  return data
}

export async function actualizarClinica(
  id: string,
  patch: { estado?: ClinicaResumen['estado']; nombre?: string },
): Promise<ClinicaResumen> {
  const { data } = await plataforma.patch<ClinicaResumen>(`/platform/tenants/${id}`, patch)
  return data
}

export async function metricasClinica(id: string): Promise<MetricasClinica> {
  const { data } = await plataforma.get<MetricasClinica>(`/platform/tenants/${id}/metricas`)
  return data
}

export async function exportarClinica(id: string): Promise<ExportClinica> {
  const { data } = await plataforma.get<ExportClinica>(`/platform/tenants/${id}/export`)
  return data
}

export async function listarPlanes(): Promise<Plan[]> {
  const { data } = await plataforma.get<Plan[]>('/platform/plans')
  return data
}

export async function asignarPlan(tenantId: string, planCodigo: string): Promise<void> {
  await plataforma.put('/platform/subscriptions', { tenantId, planCodigo })
}
