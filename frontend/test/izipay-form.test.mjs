import assert from 'node:assert/strict'
import { test } from 'node:test'
import { KRGlue } from '../src/services/izipay-glue.ts'

function diferida() {
  let resolver
  const promesa = new Promise((resolve) => { resolver = resolve })
  return { promesa, resolver }
}

async function entorno(nombre, { retenerScript = false } = {}) {
  const originales = { window: globalThis.window, document: globalThis.document }
  const nodos = []
  const llamadas = []
  const tokens = []
  let token
  let submit
  let alError
  let bloqueoDesmontaje
  let cargaPrincipal
  let scriptsSDK = 0
  let scriptsNeon = 0
  const sdk = {
    ready: true,
    async setFormConfig(config) { token = config.formToken; llamadas.push(`token:${token}`) },
    async onSubmit(callback) { submit = callback },
    async onError(callback) { alError = callback },
    removeEventCallbacks(evento) {
      if (evento === 'onSubmit') submit = undefined
      if (evento === 'onError') alError = undefined
    },
    async removeForms() {
      llamadas.push('desmontar')
      if (bloqueoDesmontaje) await bloqueoDesmontaje.promesa
    },
    async renderElements(selector) {
      assert.equal(selector, '#izipay-container')
      tokens.push(token)
      llamadas.push(`mostrar:${token}`)
      return { result: { formId: `form-${tokens.length}` } }
    },
    async showForm() {},
  }
  globalThis.window = { setTimeout, clearTimeout, setInterval, clearInterval }
  function anexar(nodo) {
    nodos.push(nodo)
    if (nodo.src?.endsWith('kr-payment-form.min.js')) {
      scriptsSDK++
      cargaPrincipal = () => {
        globalThis.window.KR = sdk
        nodo.onload?.()
      }
      if (!retenerScript) queueMicrotask(cargaPrincipal)
    } else {
      if (nodo.src?.endsWith('neon.js')) scriptsNeon++
      queueMicrotask(() => nodo.onload?.())
    }
  }
  globalThis.document = {
    createElement() {
      return { setAttribute() {}, remove() { const i = nodos.indexOf(this); if (i >= 0) nodos.splice(i, 1) } }
    },
    head: { append: anexar },
    body: { appendChild: anexar },
    querySelector(selector) {
      const src = selector.match(/^script\[src="(.+)"\]$/)?.[1]
      return nodos.find((n) => n.src === src) ?? null
    },
  }
  KRGlue.loaded = false
  KRGlue.loading = false
  KRGlue.publicKey = null
  const url = new URL('../src/services/izipay-form.ts', import.meta.url)
  url.searchParams.set('prueba', nombre)
  const { montarSmartForm } = await import(url.href)
  return {
    montarSmartForm, llamadas, tokens, nodos, sdk,
    get submit() { return submit }, get alError() { return alError },
    get scriptsSDK() { return scriptsSDK }, get scriptsNeon() { return scriptsNeon },
    get cargaPrincipal() { return cargaPrincipal },
    bloquearDesmontaje() { bloqueoDesmontaje = diferida(); return bloqueoDesmontaje },
    restaurar() {
      KRGlue.loaded = false
      KRGlue.loading = false
      KRGlue.publicKey = null
      if (originales.window === undefined) delete globalThis.window
      else globalThis.window = originales.window
      if (originales.document === undefined) delete globalThis.document
      else globalThis.document = originales.document
    },
  }
}

const config = (token, callback = async () => {}) => ({ formToken: token,
  publicKey: '12345678:testpublickey_prueba', alResultado: callback, alError() {} })

test('abrir, cerrar y reabrir usa el token nuevo y no reinicializa Krypton/Neon', async () => {
  const e = await entorno('reapertura')
  let primero
  let segundo
  let resultadosPrimero = 0
  let resultadosSegundo = 0
  try {
    primero = e.montarSmartForm(config('token-A', async () => { resultadosPrimero++ }))
    await primero.listo
    const callbackAntiguo = e.submit
    await primero.destruir()
    assert.equal(e.nodos.length, 0)
    assert.equal(window.KR, e.sdk)
    segundo = e.montarSmartForm(config('token-B', async () => { resultadosSegundo++ }))
    await segundo.listo
    assert.deepEqual(e.tokens, ['token-A', 'token-B'])
    assert.equal(e.scriptsSDK, 1)
    assert.equal(e.scriptsNeon, 1)
    assert.equal(await callbackAntiguo({}), false)
    assert.equal(resultadosPrimero, 0)
    assert.equal(await e.submit({}), false)
    assert.equal(resultadosSegundo, 1)
    assert.equal(e.llamadas[e.llamadas.indexOf('token:token-B') - 1], 'desmontar')
  } finally {
    await primero?.destruir()
    await segundo?.destruir()
    e.restaurar()
  }
})

test('una reapertura rápida espera removeForms antes de aplicar el token nuevo', async () => {
  const e = await entorno('carrera')
  let primero
  let segundo
  let bloqueo
  try {
    primero = e.montarSmartForm(config('token-A'))
    await primero.listo
    bloqueo = e.bloquearDesmontaje()
    const cierre = primero.destruir()
    segundo = e.montarSmartForm(config('token-B'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(e.tokens, ['token-A'])
    assert.ok(!e.llamadas.includes('token:token-B'))
    bloqueo.resolver()
    await cierre
    await segundo.listo
    assert.deepEqual(e.tokens, ['token-A', 'token-B'])
    assert.equal(e.scriptsSDK, 1)
  } finally {
    bloqueo?.resolver()
    await primero?.destruir()
    await segundo?.destruir()
    e.restaurar()
  }
})

test('cerrar durante la descarga no monta el token viejo ni duplica el SDK al reabrir', async () => {
  const e = await entorno('descarga', { retenerScript: true })
  let primero
  let segundo
  try {
    primero = e.montarSmartForm(config('token-cancelado'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const cierre = primero.destruir()
    segundo = e.montarSmartForm(config('token-nuevo'))
    assert.equal(e.scriptsSDK, 1)
    e.cargaPrincipal()
    await cierre
    await segundo.listo
    assert.deepEqual(e.tokens, ['token-nuevo'])
    assert.ok(!e.llamadas.includes('token:token-cancelado'))
    assert.equal(e.scriptsSDK, 1)
    assert.equal(e.scriptsNeon, 1)
  } finally {
    e.cargaPrincipal?.()
    await primero?.destruir()
    await segundo?.destruir()
    e.restaurar()
  }
})
