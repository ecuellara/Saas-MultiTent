import { defineStore } from 'pinia'
import api from '../services/api'
import { mensajeDeError } from '../services/errores'

export interface Usuario {
  id: string
  email: string
  nombre: string
  cop: string | null
}

/** Una clínica a la que el usuario tiene acceso (membresía ACTIVA). */
export interface ClinicaResumen {
  id: string
  nombre: string
  slug: string
  rol: string
  sedeId: string | null
}

/** Contexto resuelto de la clínica activa. Lo calcula SIEMPRE el backend. */
export interface SesionActiva {
  tenantId: string
  rol: string
  sedeId: string | null
  permissions: string[]
  features: Record<string, { habilitado: boolean; limite: number | null }>
}

const TOKEN_KEY = 'token'
const TENANT_KEY = 'tenantId'

/**
 * Store de sesión multi-clínica.
 *
 * Puntos de diseño que vienen de los ADR y conviene no «simplificar»:
 * - El JWT lleva **solo `sub`** (ADR-005): no incluye tenant ni rol, así que un
 *   usuario puede pertenecer a varias clínicas sin volver a iniciar sesión.
 * - La clínica activa se guarda en `localStorage` y viaja en la cabecera
 *   `X-Tenant-Id`, pero es solo una **preferencia del cliente**: el backend
 *   valida la membresía en cada petición y responde 403 si no cuadra.
 * - Los `permissions` y `features` los resuelve el servidor; el frontend los usa
 *   para **ocultar**, nunca para autorizar (la barrera es el backend).
 */
export const useSessionStore = defineStore('session', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) ?? '',
    /** Preferencia de clínica activa (el servidor tiene la última palabra). */
    tenantId: localStorage.getItem(TENANT_KEY) ?? '',
    usuario: null as Usuario | null,
    clinicas: [] as ClinicaResumen[],
    activa: null as SesionActiva | null,
    cargando: false,
    error: '',
  }),

  getters: {
    autenticado: (s) => s.token.length > 0,
    /** Hay token pero todavía no se ha elegido clínica. */
    sinClinica: (s) => s.token.length > 0 && s.tenantId.length === 0,
    clinicaActiva: (s) => s.clinicas.find((c) => c.id === s.tenantId) ?? null,
    rol: (s) => s.activa?.rol ?? '',
    /** `true` solo cuando la sesión está completamente resuelta. */
    lista: (s) => s.usuario !== null && s.activa !== null,
  },

  actions: {
    /**
     * ¿Tiene el permiso? Sin sesión resuelta devuelve `false` a propósito: así el
     * menú no muestra nada antes de saber qué puede hacer el usuario.
     */
    puede(codigo: string): boolean {
      return this.activa?.permissions.includes(codigo) ?? false
    },

    /** ¿El plan de la clínica habilita esta funcionalidad? */
    tieneFeature(clave: string): boolean {
      return this.activa?.features[clave]?.habilitado ?? false
    },

    /** Límite numérico del plan (`null` = sin límite o sin suscripción). */
    limiteDe(clave: string): number | null {
      return this.activa?.features[clave]?.limite ?? null
    },

    async iniciarSesion(email: string, password: string): Promise<boolean> {
      this.cargando = true
      this.error = ''
      try {
        const { data } = await api.post('/auth/login', { email, password })
        this.token = String(data.access_token ?? '')
        localStorage.setItem(TOKEN_KEY, this.token)
        // El login NO devuelve usuario ni clínicas (a propósito): se descarta
        // cualquier clínica de una sesión anterior, porque puede no pertenecer a
        // este usuario y `/auth/sesion` respondería 403.
        this.quitarClinica()
        await this.cargarSesion()
        return true
      } catch (e) {
        this.error = mensajeDeError(e, 'No se pudo iniciar sesión')
        this.limpiar()
        return false
      } finally {
        this.cargando = false
      }
    },

    /**
     * Único punto que resuelve la sesión: usuario + clínicas + (si ya hay clínica
     * elegida) permisos y features. Lo usa el guard del router en cada recarga.
     */
    async cargarSesion(): Promise<void> {
      if (!this.token) return
      const { data } = await api.get('/auth/sesion')
      this.usuario = (data.usuario ?? null) as Usuario | null
      this.clinicas = (data.tenants ?? []) as ClinicaResumen[]
      this.activa = (data.activo ?? null) as SesionActiva | null

      // Si la clínica guardada ya no está entre las del usuario (lo sacaron de la
      // membresía, o suspendieron la clínica), se descarta en vez de dejar la app
      // a medio cargar con un 403 en cada petición.
      if (this.tenantId && !this.clinicas.some((c) => c.id === this.tenantId)) {
        this.quitarClinica()
      }
    },

    /** Cambia de clínica activa y vuelve a resolver permisos y features. */
    async elegirClinica(tenantId: string): Promise<void> {
      this.tenantId = tenantId
      localStorage.setItem(TENANT_KEY, tenantId)
      await this.cargarSesion()
    },

    /** Descarta la clínica activa (no toca el token). */
    quitarClinica(): void {
      this.tenantId = ''
      this.activa = null
      localStorage.removeItem(TENANT_KEY)
    },

    async cerrarSesion(): Promise<void> {
      try {
        // `silencioso`: si el servidor falla, la sesión local se cierra igual.
        await api.post('/auth/logout', {}, { silencioso: true })
      } catch {
        // Intencionadamente ignorado.
      }
      this.limpiar()
    },

    limpiar(): void {
      this.token = ''
      this.tenantId = ''
      this.usuario = null
      this.clinicas = []
      this.activa = null
      this.error = ''
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(TENANT_KEY)
    },
  },
})
