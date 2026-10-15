import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enlaceWhatsapp, normalizarTelefono } from '../src/services/whatsapp.ts'

test('móvil peruano de 9 dígitos con formatos variados → 51 + número', () => {
  assert.equal(normalizarTelefono('999000111'), '51999000111')
  assert.equal(normalizarTelefono('999 000 111'), '51999000111')
  assert.equal(normalizarTelefono('999-000-111'), '51999000111')
  assert.equal(normalizarTelefono('(999) 000-111'), '51999000111')
  assert.equal(normalizarTelefono('+51 999 000 111'), '51999000111')
  assert.equal(normalizarTelefono('51999000111'), '51999000111')
  assert.equal(normalizarTelefono('0051999000111'), '51999000111')
})

test('teléfonos mal formados → null (el botón se deshabilita, no se rompe)', () => {
  assert.equal(normalizarTelefono(null), null)
  assert.equal(normalizarTelefono(''), null)
  assert.equal(normalizarTelefono('   '), null)
  assert.equal(normalizarTelefono('abc'), null)
  assert.equal(normalizarTelefono('99900011'), null) // 8 dígitos
  assert.equal(normalizarTelefono('123'), null)
  assert.equal(normalizarTelefono('99900011122233344'), null) // más de 15
  assert.equal(normalizarTelefono('6111222'), null) // 7 dígitos
})

test('números con país extranjero se dejan tal cual', () => {
  assert.equal(normalizarTelefono('+1 222 333 4444'), '12223334444')
  assert.equal(normalizarTelefono('34911222333'), '34911222333')
})

test('el enlace wa.me lleva el mensaje codificado', () => {
  const url = enlaceWhatsapp('51999000111', 'Hola Valeria, tu cita es el 20/10/2026')
  assert.equal(
    url,
    'https://wa.me/51999000111?text=' + encodeURIComponent('Hola Valeria, tu cita es el 20/10/2026'),
  )
  assert.ok(url.startsWith('https://wa.me/51999000111?text='))
})
