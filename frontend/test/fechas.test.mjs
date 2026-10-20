import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diasSemana, diaSemanaCivil, finMes, hora12, inicioMes, inicioSemana, sumarMinutos } from '../src/services/fechas.ts'

test('día de la semana en UTC (2026-10-15 es jueves)', () => {
  assert.equal(diaSemanaCivil('2026-10-15'), 4)
  assert.equal(diaSemanaCivil('2026-10-18'), 0)
  assert.equal(diaSemanaCivil('2026-10-19'), 1)
})

test('la semana empieza el lunes y tiene 7 días', () => {
  assert.equal(inicioSemana('2026-10-15'), '2026-10-12')
  assert.equal(inicioSemana('2026-10-12'), '2026-10-12')
  assert.equal(inicioSemana('2026-10-18'), '2026-10-12')
  assert.deepEqual(diasSemana('2026-10-15'), [
    '2026-10-12',
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
    '2026-10-16',
    '2026-10-17',
    '2026-10-18',
  ])
})

test('inicio y fin de mes (febrero bisiesto incluido)', () => {
  assert.equal(inicioMes('2026-10-15'), '2026-10-01')
  assert.equal(finMes('2026-10-15'), '2026-10-31')
  assert.equal(finMes('2026-02-10'), '2026-02-28')
  assert.equal(finMes('2024-02-10'), '2024-02-29')
  assert.equal(finMes('2026-04-01'), '2026-04-30')
})

test('horas vacías o incompletas no producen NaN', () => {
  // `''.split(':')` deja `m` en `undefined`: `Number.isNaN(undefined)` es false
  // y antes se mostraba «NaN:NaN» / «12:undefined a. m.».
  assert.equal(hora12(''), '')
  // Incompleta: se devuelve tal cual en vez de fabricar «12:undefined a. m.».
  assert.equal(hora12('9'), '9')
  assert.equal(sumarMinutos('', 30), '')
  assert.equal(hora12(sumarMinutos('', 30)), '')
  assert.equal(sumarMinutos('09:30', 30), '10:00')
  assert.equal(hora12('09:30'), '9:30 a. m.')
})
