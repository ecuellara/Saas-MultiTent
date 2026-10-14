import axios from 'axios'
import { instalarRefresh } from './refresh-session'

declare module 'axios' {
  export interface AxiosRequestConfig {
    /**
     * Endpoint OPCIONAL: un 401 aquí no debe cerrar la sesión ni navegar.
     * Sin esto, cualquier llamada secundaria que devolviera 401 (un logo, un
     * sondeo de estado) expulsaba al usuario y le borraba el formulario.
     */
    silencioso?: boolean
  }
}

const api = axios.create({
  // En desarrollo se deja relativo para que Vite proxye `/api` al backend y el
  // navegador vea un mismo origen. En Vercel /api también es relativa y se
  // reescribe hacia Render para conservar la cookie SameSite=Strict.
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
  // El refresh viaja en cookie httpOnly (`path=/api/auth`).
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`

  // El tenant activo NO va en el JWT (ADR-005): viaja en la cabecera y el
  // backend valida la membresía en CADA petición. Aquí es solo una preferencia
  // del cliente; la autoridad es el servidor.
  const tenantId = localStorage.getItem('tenantId')
  if (tenantId) config.headers['X-Tenant-Id'] = tenantId
  return config
})

instalarRefresh(api, {
  ruta: '/auth/refresh',
  leerToken: () => localStorage.getItem('token') ?? '',
  guardarToken: (token) => {
    localStorage.setItem('token', token)
    window.dispatchEvent(new CustomEvent('sesion:renovada', { detail: token }))
  },
  expirar: () => {
    localStorage.removeItem('token')
    localStorage.removeItem('tenantId')
    window.dispatchEvent(new Event('sesion:expirada'))
  },
})

export default api
