import { defineStore } from 'pinia'
import {
  cerrarSesionPlataforma,
  guardarTokenPlataforma,
  leerTokenPlataforma,
  loginPlataforma,
  mfaConfirm,
  mfaSetup,
  mfaVerify,
  quitarTokenPlataforma,
} from '../services/plataforma'
import { mensajeDeError } from '../services/errores'

export type PasoMfa = 'clave' | 'setup' | 'verify'

/**
 * Sesión del PANEL DE PLATAFORMA. Store separado del de clínica a propósito:
 * otro token (`platform_token`), otro interceptor, otro guard y otras rutas
 * (`/admin/*`). Nunca se mezclan: el área de plataforma no conoce `tenantId`.
 */
export const usePlataformaStore = defineStore('plataforma', {
  state: () => ({
    token: leerTokenPlataforma(),
    ownerEmail: '',
    ownerRol: '',
    paso: 'clave' as PasoMfa,
    /** Temporal MFA: solo en memoria, nunca en localStorage (vive 5 min). */
    tempToken: '',
    secret: '',
    otpauthUrl: '',
    cargando: false,
    error: '',
  }),

  getters: {
    autenticado: (s) => s.token.length > 0,
  },

  actions: {
    /**
     * Login. Devuelve el paso siguiente: `'ok'` (sesión plena), `'setup'`
     * (enrolar TOTP) o `'verify'` (pedir código). Sin atajos: con MFA
     * obligatoria nunca se emite sesión plena solo con clave.
     */
    async iniciarSesion(email: string, password: string): Promise<'ok' | 'setup' | 'verify'> {
      this.cargando = true
      this.error = ''
      try {
        const r = await loginPlataforma(email.trim(), password)
        if ('access_token' in r) {
          this.establecerSesion(r.access_token, email.trim())
          return 'ok'
        }
        this.tempToken = r.temp_token
        this.ownerEmail = email.trim()
        if ('mfa_setup_required' in r) {
          this.paso = 'setup'
          return 'setup'
        }
        this.paso = 'verify'
        return 'verify'
      } catch (e) {
        this.error = mensajeDeError(e, 'No se pudo iniciar sesión')
        this.limpiar()
        throw e
      } finally {
        this.cargando = false
      }
    },

    /** Inicia el enrolamiento TOTP con el temporal de alta. */
    async iniciarSetup(): Promise<void> {
      this.cargando = true
      this.error = ''
      try {
        const r = await mfaSetup(this.tempToken)
        this.secret = r.secret
        this.otpauthUrl = r.otpauth_url
      } catch (e) {
        this.error = mensajeDeError(e, 'No se pudo iniciar el enrolamiento')
        throw e
      } finally {
        this.cargando = false
      }
    },

    /** Confirma el enrolamiento y vuelve a pedir clave (el temporal era de alta). */
    async confirmarSetup(code: string): Promise<void> {
      this.cargando = true
      this.error = ''
      try {
        await mfaConfirm(this.tempToken, code)
        this.volverAClave()
      } catch (e) {
        this.error = mensajeDeError(e, 'Código incorrecto')
        throw e
      } finally {
        this.cargando = false
      }
    },

    /** Verifica el TOTP del login y establece la sesión plena. */
    async verificar(code: string): Promise<void> {
      this.cargando = true
      this.error = ''
      try {
        const r = await mfaVerify(this.tempToken, code)
        this.establecerSesion(r.access_token, this.ownerEmail)
      } catch (e) {
        this.error = mensajeDeError(e, 'Código incorrecto')
        throw e
      } finally {
        this.cargando = false
      }
    },

    volverAClave(): void {
      this.paso = 'clave'
      this.tempToken = ''
      this.secret = ''
      this.otpauthUrl = ''
      this.error = ''
    },

    async cerrarSesion(): Promise<void> {
      try {
        await cerrarSesionPlataforma()
      } catch {
        // Intencionadamente ignorado: la sesión local se cierra igual.
      }
      this.limpiar()
    },

    limpiar(): void {
      this.token = ''
      this.ownerEmail = ''
      this.ownerRol = ''
      this.volverAClave()
      quitarTokenPlataforma()
    },

    /** Fija token + datos de cabecera (solo informativo: autoriza el backend). */
    establecerSesion(token: string, email: string): void {
      this.token = token
      guardarTokenPlataforma(token)
      this.ownerEmail = email
      this.ownerRol = rolDeToken(token)
      this.volverAClave()
    },
  },
})

/** `rol` del payload (solo para mostrar; sin validar firma). */
function rolDeToken(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? '')) as { rol?: unknown }
    return typeof payload.rol === 'string' ? payload.rol : ''
  } catch {
    return ''
  }
}
