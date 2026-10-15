import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  arcadas,
  DECIDUOS_INF,
  DECIDUOS_SUP,
  PERMANENTES_INF,
  PERMANENTES_SUP,
  toothMeta,
} from '../src/components/odontograma/teeth.ts'

test('el catálogo FDI incluye 32 permanentes y 20 deciduos (52 en total)', () => {
  assert.equal(PERMANENTES_SUP.length, 16)
  assert.equal(PERMANENTES_INF.length, 16)
  assert.equal(DECIDUOS_SUP.length, 10)
  assert.equal(DECIDUOS_INF.length, 10)
  assert.equal(
    PERMANENTES_SUP.length + PERMANENTES_INF.length + DECIDUOS_SUP.length + DECIDUOS_INF.length,
    52,
  )
  // Cuadrantes deciduos 5–8 presentes (lo que el editor anterior ocultaba).
  assert.deepEqual([...new Set([...DECIDUOS_SUP, ...DECIDUOS_INF].map((n) => n[0]))].sort(), ['5', '6', '7', '8'])
})

test('toothMeta deriva tipo, arcada, superficie oclusal/incisal y palatina/lingual', () => {
  const incisivo = toothMeta('11')
  assert.equal(incisivo.superior, true)
  assert.equal(incisivo.posterior, false) // incisal (I)
  assert.equal(incisivo.tipo, 'incisivo')
  assert.equal(toothMeta('16').posterior, true) // oclusal (O)
  assert.equal(toothMeta('16').mesialRight, true)
  assert.equal(toothMeta('36').superior, false) // lingual (L)
  assert.equal(toothMeta('55').decidua, true)
  assert.equal(toothMeta('85').decidua, true)
  // En la dentición decidua NO hay premolares: las posiciones 4 y 5 son el
  // primer y segundo molar temporal (si no, se dibujan con corona de premolar).
  assert.equal(toothMeta('54').tipo, 'molar')
  assert.equal(toothMeta('55').tipo, 'molar')
  assert.equal(toothMeta('53').tipo, 'canino')
  assert.equal(toothMeta('85').tipo, 'molar')
  assert.equal(toothMeta('45').tipo, 'premolar') // permanente: aquí sí hay premolar
})

test('con deciduos visibles el orden es: perm sup, decid sup, decid inf, perm inf', () => {
  const titulos = arcadas(true).map((f) => f.titulo)
  assert.deepEqual(titulos, [
    'Permanentes superiores · 18–28',
    'Deciduos superiores · 55–65',
    'Deciduos inferiores · 85–75',
    'Permanentes inferiores · 48–38',
  ])
  // El 85–75 queda justo debajo de los deciduos superiores, no al final.
  const piezas = arcadas(true).map((f) => [...f.a, ...f.b])
  assert.deepEqual(piezas[2].slice(0, 3), ['85', '84', '83'])
  assert.ok(piezas[2].includes('75'))
})

test('con deciduos ocultos solo quedan las dos filas permanentes', () => {
  const filas = arcadas(false)
  assert.deepEqual(
    filas.map((f) => f.titulo),
    ['Permanentes superiores · 18–28', 'Permanentes inferiores · 48–38'],
  )
})
