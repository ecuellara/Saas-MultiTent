import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fuente = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../src/components/odontograma/DienteSvg.vue'),
  'utf8',
)

test('la corona seleccionable domina la tarjeta (raíces cortas, sin selección)', () => {
  const viewBox = fuente.match(/viewBox="0 0 100 (\d+)"/)
  assert.ok(viewBox, 'viewBox presente en el SVG')
  const alto = Number(viewBox[1])
  assert.ok(alto <= 120, `tarjeta compacta, alto=${alto}`)

  // Polígonos de zonas clicables: 'x,y x,y ...' (laterales = triángulos).
  const zonas = [...fuente.matchAll(/puntos: '([\d., ]+)'/g)]
  assert.equal(zonas.length, 5, 'las 5 zonas de superficie')
  const puntos = zonas.flatMap((m) =>
    m[1].trim().split(/\s+/).map((p) => p.split(',').map(Number)),
  )
  assert.equal(puntos.length, 4 + 4 + 3 + 3 + 4, 'vértices de las 5 zonas')
  const ys = puntos.map(([, y]) => y)
  const altoZonas = Math.max(...ys) - Math.min(...ys)
  assert.ok(altoZonas / alto >= 0.3, `las zonas ocupan ${altoZonas}/${alto} del alto`)
  // Las zonas viven en la corona, no en las raíces (empiezan en y=72).
  assert.ok(Math.max(...ys) <= 72, 'ninguna zona invade la zona de raíces')
})
