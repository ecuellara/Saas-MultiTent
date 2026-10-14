import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as moduloReal from '@lyracom/embedded-form-glue'
import { KRGlue, resolverKRGlue } from '../src/services/izipay-glue.ts'

test('resuelve la instancia real del paquete CommonJS y sus wrappers ESM', () => {
  assert.equal(typeof KRGlue.loadLibrary, 'function')
  assert.equal(resolverKRGlue(moduloReal), KRGlue)
  assert.equal(resolverKRGlue(KRGlue), KRGlue)
  assert.equal(resolverKRGlue({ default: KRGlue }), KRGlue)
  assert.equal(resolverKRGlue({ default: { default: KRGlue } }), KRGlue)
  assert.throws(() => resolverKRGlue({ default: {} }), /inicializar la librería KRGlue/)
})

test('loadLibrary del paquete real devuelve KR y permite reabrir después del reset, sin red', async () => {
  const ventanaAnterior = globalThis.window
  const documentoAnterior = globalThis.document
  let scriptsCreados = 0
  const kr = { ready: true }
  globalThis.window = { KR: kr }
  globalThis.document = {
    createElement: () => { scriptsCreados++; return { setAttribute() {} } },
    querySelector: () => ({}), // El script ya está precargado: nunca se pide red.
    body: { appendChild() { throw new Error('No debe inyectar un segundo script') } },
  }
  try {
    for (let apertura = 0; apertura < 2; apertura++) {
      KRGlue.loaded = false
      KRGlue.loading = false
      KRGlue.publicKey = null
      const resultado = await KRGlue.loadLibrary('https://static.micuentaweb.pe', '12345678:testpublickey_prueba')
      assert.equal(resultado.KR, kr)
      assert.equal(KRGlue.loaded, true)
      assert.equal(KRGlue.loading, false)
    }
    assert.equal(scriptsCreados, 2)
  } finally {
    KRGlue.loaded = false
    KRGlue.loading = false
    KRGlue.publicKey = null
    KRGlue.formToken = null
    KRGlue.domain = null
    if (ventanaAnterior === undefined) delete globalThis.window
    else globalThis.window = ventanaAnterior
    if (documentoAnterior === undefined) delete globalThis.document
    else globalThis.document = documentoAnterior
  }
})
