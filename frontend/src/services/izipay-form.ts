import { KRGlue } from './izipay-glue.ts'

type Krypton = KR & { ready?: unknown }

const ENDPOINT = 'https://static.micuentaweb.pe'
const RECURSOS = `${ENDPOINT}/static/js/krypton-client/V4.0`
const TIEMPO_CARGA = 15000
const ventana = window as unknown as { KR?: Krypton }

// Serializa desmontaje/reapertura: la librería y el tema mantienen estado global.
let limpiezaAnterior: Promise<void> = Promise.resolve()
let neonCargado = false

export interface FormularioIzipay {
  listo: Promise<void>
  destruir(): Promise<void>
}

export function montarSmartForm(config: {
  formToken: string
  publicKey: string
  alResultado(resultado: KRPaymentResponse): Promise<void>
  alError(): void
}): FormularioIzipay {
  let activo = true
  let kr: Krypton | undefined
  let destruccion: Promise<void> | undefined
  const recursos: HTMLElement[] = []
  const anterior = limpiezaAnterior

  function cargar(recurso: HTMLScriptElement | HTMLLinkElement): Promise<void> {
    return new Promise((resolve, reject) => {
      const terminar = (error?: Error) => {
        window.clearTimeout(timeout)
        recurso.onload = null
        recurso.onerror = null
        if (error) reject(error)
        else resolve()
      }
      const timeout = window.setTimeout(() => terminar(new Error('Tiempo de carga de Izipay agotado')), TIEMPO_CARGA)
      recurso.onload = () => terminar()
      recurso.onerror = () => terminar(new Error('No se pudieron cargar los recursos de Izipay'))
      recursos.push(recurso)
      document.head.append(recurso)
    })
  }

  function esperarKrypton(): Promise<void> {
    if (ventana.KR?.ready) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const terminar = (error?: Error) => {
        window.clearInterval(intervalo)
        window.clearTimeout(timeout)
        if (error) reject(error)
        else resolve()
      }
      const intervalo = window.setInterval(() => {
        if (ventana.KR?.ready) terminar()
      }, 25)
      const timeout = window.setTimeout(() => terminar(new Error('Krypton no está disponible')), TIEMPO_CARGA)
    })
  }

  const listo = (async () => {
    await anterior
    if (!activo) return
    // No volver a ejecutar el SDK en una SPA: eliminar window.KR no descarga
    // sus listeners/iframes internos. Reutilizamos la instancia viva.
    // La primera carga tiene timeout; si se cierra durante la descarga dejamos
    // que termine antes de limpiar/reabrir, para impedir ejecuciones tardías.
    if (!ventana.KR?.ready) {
      const script = document.createElement('script')
      script.src = `${RECURSOS}/stable/kr-payment-form.min.js`
      script.setAttribute('kr-public-key', config.publicKey)
      script.setAttribute('kr-spa-mode', 'true')
      script.setAttribute('kr-language', 'es-ES')
      await cargar(script)
    }
    await esperarKrypton()
    const resultado = await KRGlue.loadLibrary(ENDPOINT, config.publicKey)
    kr = resultado.KR
    if (!activo) return

    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${RECURSOS}/ext/neon-reset.min.css`
    const cargas = [cargar(css)]
    if (!neonCargado) {
      const tema = document.createElement('script')
      tema.src = `${RECURSOS}/ext/neon.js`
      cargas.push(cargar(tema).then(() => { neonCargado = true }))
    }
    // Neon registra plugins globales; se ejecuta una vez, el CSS sí se repone.
    await Promise.all(cargas)
    if (!activo) return
    await kr.removeForms()
    if (!activo) return
    kr.removeEventCallbacks('onSubmit')
    kr.removeEventCallbacks('onError')
    // Siempre el token de ESTA apertura, después de completar el desmontaje
    // anterior y antes de registrar callbacks o renderizar campos de tarjeta.
    await kr.setFormConfig({ formToken: config.formToken, 'kr-language': 'es-ES' })
    if (!activo) return
    await kr.onSubmit(async (data) => {
      if (activo) await config.alResultado(data)
      return false // El navegador solo consulta el pago; el IPN confirma el cobro.
    })
    await kr.onError(() => { if (activo) config.alError() })
    if (!activo) return
    const { result } = await kr.renderElements('#izipay-container')
    if (!activo) return
    await kr.showForm(result.formId)
  })()

  function destruir(): Promise<void> {
    if (destruccion) return destruccion
    activo = false
    destruccion = (async () => {
      await listo.catch(() => undefined)
      try {
        if (kr) {
          kr.removeEventCallbacks('onSubmit')
          kr.removeEventCallbacks('onError')
          await kr.removeForms()
        }
      } finally {
        for (const recurso of recursos) recurso.remove()
      }
      // Conservamos KR y KRGlue: removeForms desmonta el checkout, no el SDK.
    })().catch(() => undefined)
    limpiezaAnterior = destruccion
    return destruccion
  }

  return { listo, destruir }
}
