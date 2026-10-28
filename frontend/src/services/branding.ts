import type { Configuracion } from './configuracion'

/** Mismo marcador que escribe el backend en `TenantConfig.logoUrl`. */
export const LOGO_MARCA_STORAGE = '__storage__'

export interface ColoresMarca {
  primario: string
  acento: string
}

export const COLORES_POR_DEFECTO: ColoresMarca = {
  primario: '#0756a3',
  acento: '#12b8ce',
}

const HEX = /^#[0-9a-fA-F]{6}$/
const ULTIMA_CLINICA_SLUG_KEY = 'branding_slug'
const CACHE_MARCA_KEY = 'branding_ultima'
const API_BASE = import.meta.env.VITE_API_URL || '/api'

export interface MarcaCache {
  slug: string
  tieneLogo: boolean
  version: string
  colores: ColoresMarca | null
}

/** Normaliza `TenantConfig.colores` (Json libre) a la forma que usa la app. */
export function normalizarColores(valor: unknown): ColoresMarca | null {
  if (!valor || typeof valor !== 'object') return null
  const objeto = valor as Record<string, unknown>
  const primario = typeof objeto.primario === 'string' ? objeto.primario : ''
  const acento = typeof objeto.acento === 'string' ? objeto.acento : ''
  if (!HEX.test(primario) || !HEX.test(acento)) return null
  return { primario: primario.toLowerCase(), acento: acento.toLowerCase() }
}

/**
 * Deriva `--primary-dark` mezclando el primario con negro al 18 % (cada canal
 * RGB × 0.82). Es determinista y conserva el tono; no depende de librerías.
 */
export function oscurecerHex(hex: string): string {
  if (!HEX.test(hex)) return COLORES_POR_DEFECTO.primario
  const valor = hex.slice(1)
  const canales = [0, 2, 4].map((i) =>
    Math.round(parseInt(valor.slice(i, i + 2), 16) * 0.82),
  )
  return `#${canales.map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

/** Aplica los colores del tenant en `documentElement`; sin colores, restaura. */
export function aplicarColoresTenant(valor: unknown): ColoresMarca | null {
  const colores = normalizarColores(valor)
  if (!colores) {
    restablecerColores()
    return null
  }
  const raiz = document.documentElement
  raiz.style.setProperty('--primary', colores.primario)
  raiz.style.setProperty('--primary-dark', oscurecerHex(colores.primario))
  raiz.style.setProperty('--secondary', colores.acento)
  return colores
}

/** Vuelve a los colores por defecto del tema (también en modo oscuro). */
export function restablecerColores(): void {
  const raiz = document.documentElement
  raiz.style.removeProperty('--primary')
  raiz.style.removeProperty('--primary-dark')
  raiz.style.removeProperty('--secondary')
}

/** URL pública del logo (el backend lo lee del bucket privado). */
export function urlLogoPublico(slug: string, version?: string): string {
  const base = `${API_BASE}/publico/logo/${encodeURIComponent(slug)}`
  return version ? `${base}?v=${encodeURIComponent(version)}` : base
}

export function guardarSlugMarca(slug: string): void {
  if (slug) localStorage.setItem(ULTIMA_CLINICA_SLUG_KEY, slug)
}

export function leerSlugMarca(): string {
  return localStorage.getItem(ULTIMA_CLINICA_SLUG_KEY) ?? ''
}

/** Guarda la última marca vista para pintarla en el login (antes de autenticar). */
export function guardarCacheMarca(marca: MarcaCache): void {
  if (!marca.slug) return
  localStorage.setItem(CACHE_MARCA_KEY, JSON.stringify(marca))
}

/** Lee la marca cacheada del último login; nunca lanza con JSON corrupto. */
export function leerCacheMarca(): MarcaCache | null {
  const crudo = localStorage.getItem(CACHE_MARCA_KEY)
  if (!crudo) return null
  try {
    const valor = JSON.parse(crudo) as Record<string, unknown>
    const slug = typeof valor.slug === 'string' ? valor.slug : ''
    if (!slug) return null
    return {
      slug,
      tieneLogo: valor.tieneLogo === true,
      version: typeof valor.version === 'string' ? valor.version : '',
      colores: normalizarColores(valor.colores),
    }
  } catch {
    return null
  }
}

export function tieneLogoStorage(config: Pick<Configuracion, 'logoUrl'>): boolean {
  return config.logoUrl === LOGO_MARCA_STORAGE
}
