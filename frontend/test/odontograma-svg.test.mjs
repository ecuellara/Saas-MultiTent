import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fuente = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/components/odontograma/DienteSvg.vue'),
  'utf8',
)

function viewBox() {
  const m = fuente.match(/viewBox="(\d+) (\d+) (\d+) (\d+)"/)
  assert.ok(m, 'viewBox presente en el SVG')
  const [, x, y, w, h] = m.map(Number)
  return { x, y, w, h }
}

function puntosZonas() {
  // Polígonos de zonas clicables: 'x,y x,y ...' (laterales = triángulos).
  const zonas = [...fuente.matchAll(/puntos: '([\d., ]+)'/g)]
  assert.equal(zonas.length, 5, 'las 5 zonas de superficie')
  return zonas.flatMap((m) =>
    m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number)),
  )
}

test('el viewBox está recortado al dibujo: el diente llena la tarjeta', () => {
  const vb = viewBox()
  // Sin márgenes muertos: el contenido (símbolos X en x 18–82, textos y número)
  // cabe justo con ~4px de aire por lado.
  assert.ok(vb.w <= 76, `ancho recortado, w=${vb.w}`)
  assert.ok(vb.h <= 112, `alto recortado, h=${vb.h}`)
})

test('la corona seleccionable domina la tarjeta (raíces cortas, sin selección)', () => {
  const vb = viewBox()
  const puntos = puntosZonas()
  assert.equal(puntos.length, 4 + 4 + 3 + 3 + 4, 'vértices de las 5 zonas')
  const xs = puntos.map(([x]) => x)
  const ys = puntos.map(([, y]) => y)
  const anchoZonas = Math.max(...xs) - Math.min(...xs)
  const altoZonas = Math.max(...ys) - Math.min(...ys)
  assert.ok(anchoZonas / vb.w >= 0.5, `las zonas ocupan ${anchoZonas}/${vb.w} del ancho`)
  assert.ok(altoZonas / vb.h >= 0.3, `las zonas ocupan ${altoZonas}/${vb.h} del alto`)
  // Las zonas viven en la corona, no en las raíces (empiezan en y=72).
  assert.ok(Math.max(...ys) <= 72, 'ninguna zona invade la zona de raíces')
})
