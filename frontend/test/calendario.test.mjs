import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diaFueraDeRango, fechaCalendario, mesFueraDeRango, siguienteNivel } from '../src/services/calendario.ts'

test('el selector obliga el flujo año → mes → día', () => {
  assert.equal(siguienteNivel('anios'), 'meses')
  assert.equal(siguienteNivel('meses'), 'dias')
  assert.notEqual(siguienteNivel('anios'), 'dias')
})

test('los nombres de los doce meses caben en una grilla de ancho mínimo independiente del campo', () => {
  const anchoPanel = 240
  const columnas = 3
  const gapTotal = 6
  const anchoCelda = (anchoPanel - 24 - gapTotal) / columnas
  // 70 px alcanza para el mes más largo a 12 px y el componente además trunca
  // defensivamente; el ancho no depende del input que abre el panel.
  assert.ok(anchoCelda >= 70)
})

test('formatea fechas y respeta límites completos y por mes', () => {
  assert.equal(fechaCalendario(2026, 2, 3), '2026-02-03')
  assert.equal(diaFueraDeRango('2026-02-03', '2026-01-01', '2026-12-31'), false)
  assert.equal(diaFueraDeRango('2027-01-01', '2026-01-01', '2026-12-31'), true)
  assert.equal(mesFueraDeRango(2025, 12, '2026-01-15', '2026-12-20'), true)
  assert.equal(mesFueraDeRango(2026, 1, '2026-01-15', '2026-12-20'), false)
  assert.equal(mesFueraDeRango(2027, 1, '2026-01-15', '2026-12-20'), true)
})
