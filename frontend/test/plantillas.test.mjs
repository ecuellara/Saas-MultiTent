import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EJEMPLO_MARCADORES, sustituirMarcadores, vistaPrevia } from '../src/services/plantillas-marcadores.ts'

test('sustituye marcadores conocidos y deja el resto tal cual', () => {
  assert.equal(
    sustituirMarcadores('Hola {{paciente}}, el {{fecha}}', { paciente: 'Ana' }),
    'Hola Ana, el {{fecha}}',
  )
  assert.equal(sustituirMarcadores('a {{ x }} b', { x: 'Z' }), 'a {{ x }} b')
  assert.equal(sustituirMarcadores('{{hora}} y {{hora}}', { hora: '10:00' }), '10:00 y 10:00')
})

test('la vista previa usa los datos de ejemplo', () => {
  const texto = vistaPrevia('Hola {{paciente}}, el {{fecha}} a las {{hora}}.')
  assert.equal(texto, `Hola ${EJEMPLO_MARCADORES.paciente}, el ${EJEMPLO_MARCADORES.fecha} a las ${EJEMPLO_MARCADORES.hora}.`)
  assert.ok(!texto.includes('{{'))
})
