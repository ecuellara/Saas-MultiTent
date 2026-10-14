import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
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
})
