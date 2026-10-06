import axios, { type AxiosError } from 'axios'

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
  // navegador vea un mismo origen (evita CORS y problemas con la cookie del
  // refresh). En producción `VITE_API_URL` es absoluta.
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

api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    const status = err.response?.status
    if (status === 401 && err.config?.silencioso !== true) {
      // Token caducado o revocado. Se limpia el almacenamiento y se AVISA por
      // evento; la navegación la decide la app (sin recarga dura).
      localStorage.removeItem('token')
      localStorage.removeItem('tenantId')
      window.dispatchEvent(new Event('sesion:expirada'))
    }
    return Promise.reject(err)
  },
)

export default api
