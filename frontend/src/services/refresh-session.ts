import axios, { type AxiosError, type AxiosInstance } from 'axios'

declare module 'axios' {
  interface AxiosRequestConfig { refreshIntentado?: boolean }
}

/** Transporte: rota la cookie existente, sin mezclar sesiones ni reintentar en bucle. */
export function instalarRefresh(cliente: AxiosInstance, opciones: {
  ruta: string
  leerToken(): string
  guardarToken(token: string): void
  expirar(): void
}): void {
  const renovacion = axios.create({ baseURL: cliente.defaults.baseURL, timeout: cliente.defaults.timeout,
    withCredentials: true, adapter: cliente.defaults.adapter })
  let pendiente: Promise<string> | null = null
  const expirar = () => { if (opciones.leerToken()) opciones.expirar() }

  cliente.interceptors.response.use((respuesta) => respuesta, async (error: AxiosError) => {
    const config = error.config
    // Un 401 de login/MFA o de un resultado de pago firmado no es una caducidad JWT.
    const acceso = /\/(?:platform\/)?auth\/(?:login|refresh|logout|mfa(?:\/|$))/.test(config?.url ?? '')
    if (error.response?.status !== 401 || !config || config.silencioso || acceso) throw error
    const actual = opciones.leerToken()
    if (!actual) throw error
    if (config.refreshIntentado) { expirar(); throw error }
    config.refreshIntentado = true

    // Una respuesta tardía puede contener el Bearer anterior a una renovación ya terminada.
    if (String(config.headers.Authorization ?? '') !== `Bearer ${actual}`) {
      config.headers.Authorization = `Bearer ${actual}`
      return cliente.request(config)
    }
    try {
      if (!pendiente) {
        const tokenAnterior = actual
        pendiente = renovacion.post<{ access_token: string }>(opciones.ruta, {}).then(({ data }) => {
          if (opciones.leerToken() !== tokenAnterior) throw new Error('La sesión cambió durante la renovación')
          if (typeof data.access_token !== 'string' || !data.access_token) throw new Error('Respuesta de refresh inválida')
          opciones.guardarToken(data.access_token)
          return data.access_token
        }).finally(() => { pendiente = null })
      }
      config.headers.Authorization = `Bearer ${await pendiente}`
      return cliente.request(config)
    } catch (e) {
      // Un corte de red/5xx no revoca la sesión local; se puede intentar después.
      if (axios.isAxiosError(e) && e.response?.status === 401) expirar()
      throw e
    }
  })
}
