/**
 * Canal entre pestañas para el cierre de sesión.
 *
 * El evento `storage` ya avisa cuando otra pestaña borra el token, pero no
 * distingue un cierre deliberado de un simple cambio. `BroadcastChannel` da el
 * aviso explícito y llega antes; donde no existe (navegadores antiguos) el
 * `storage` sigue cubriendo el caso.
 */
const NOMBRE = 'dental-saas-sesion'

let canal: BroadcastChannel | null = null

try {
  if (typeof BroadcastChannel !== 'undefined') canal = new BroadcastChannel(NOMBRE)
} catch {
  canal = null
}

/** Avisa al resto de pestañas de que la sesión se cerró. */
export function avisarCierreSesion(): void {
  canal?.postMessage('logout')
}

/** Escucha el cierre de sesión de otra pestaña. Devuelve la baja del listener. */
export function escucharCierreSesion(alCerrar: () => void): () => void {
  const actual = canal
  if (!actual) return () => {}
  const manejador = (evento: MessageEvent): void => {
    if (evento.data === 'logout') alCerrar()
  }
  actual.addEventListener('message', manejador)
  return () => actual.removeEventListener('message', manejador)
}
