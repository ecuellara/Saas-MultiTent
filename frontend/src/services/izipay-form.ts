import { KRGlue } from './izipay-glue'

type Krypton = KR & { ready?: unknown }

const ENDPOINT = 'https://static.micuentaweb.pe'
const RECURSOS = `${ENDPOINT}/static/js/krypton-client/V4.0`
const TIEMPO_CARGA = 15000
const ventana = window as unknown as { KR?: Krypton }

// Serializa desmontaje/reapertura: la librería y el tema mantienen estado global.
let limpiezaAnterior: Promise<void> = Promise.resolve()

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
  const abort = new AbortController()
  const recursos: HTMLElement[] = []
  const anterior = limpiezaAnterior

  function cargar(recurso: HTMLScriptElement | HTMLLinkElement): Promise<void> {
    return new Promise((resolve, reject) => {
      const terminar = (error?: Error) => {
        window.clearTimeout(timeout)
        abort.signal.removeEventListener('abort', cancelar)
        recurso.onload = null
        recurso.onerror = null
        if (error) reject(error)
        else resolve()
      }
      const cancelar = () => terminar(new Error('Formulario cerrado'))
      const timeout = window.setTimeout(() => terminar(new Error('Tiempo de carga de Izipay agotado')), TIEMPO_CARGA)
      recurso.onload = () => terminar()
      recurso.onerror = () => terminar(new Error('No se pudieron cargar los recursos de Izipay'))
      abort.signal.addEventListener('abort', cancelar, { once: true })
      recursos.push(recurso)
      document.head.append(recurso)
    })
  }

  function esperarKrypton(): Promise<void> {
    return new Promise((resolve, reject) => {
      const terminar = (error?: Error) => {
        window.clearInterval(intervalo)
        window.clearTimeout(timeout)
        abort.signal.removeEventListener('abort', cancelar)
        if (error) reject(error)
        else resolve()
      }
      const cancelar = () => terminar(new Error('Formulario cerrado'))
      const intervalo = window.setInterval(() => {
        if (ventana.KR?.ready) terminar()
      }, 25)
      const timeout = window.setTimeout(() => terminar(new Error('Krypton no está disponible')), TIEMPO_CARGA)
      abort.signal.addEventListener('abort', cancelar, { once: true })
    })
  }

  const listo = (async () => {
    await anterior
    if (!activo) return
    // KRGlue 1.4.4 espera KR indefinidamente y no admite cancelar su carga.
    // Precargamos con timeout/abort; loadLibrary reconoce este mismo script.
    const script = document.createElement('script')
    script.src = `${RECURSOS}/stable/kr-payment-form.min.js`
    script.setAttribute('kr-public-key', config.publicKey)
    script.setAttribute('kr-spa-mode', 'true')
    script.setAttribute('kr-language', 'es-ES')
    await cargar(script)
    if (!activo) return
    await esperarKrypton()
    if (!activo) return
    const resultado = await KRGlue.loadLibrary(ENDPOINT, config.publicKey)
    kr = resultado.KR
    if (!activo) return

    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = `${RECURSOS}/ext/neon-reset.min.css`
    const tema = document.createElement('script')
    tema.src = `${RECURSOS}/ext/neon.js`
    // El tema se inicializa con Krypton listo y antes de montar el SmartForm.
    await Promise.all([cargar(css), cargar(tema)])
    if (!activo) return
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
    abort.abort()
    destruccion = (async () => {
      await listo.catch(() => undefined)
      if (kr) {
        kr.removeEventCallbacks('onSubmit')
        kr.removeEventCallbacks('onError')
        await kr.removeForms().catch(() => undefined)
      }
      for (const recurso of recursos) recurso.remove()
      // Reset explícito requerido por el singleton de la versión fijada 1.4.4.
      // Sin él loadLibrary intentaría reutilizar un KR que ya desmontamos.
      if (recursos.length) {
        delete ventana.KR
        KRGlue.loaded = false
        KRGlue.loading = false
        KRGlue.publicKey = null
        KRGlue.formToken = null
        KRGlue.domain = null
      }
    })()
    limpiezaAnterior = destruccion
    return destruccion
  }

  return { listo, destruir }
}
