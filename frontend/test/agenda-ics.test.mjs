import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  aUtcCompacto,
  citaLimaAUtc,
  DESPLAZAMIENTO_LIMA_MINUTOS,
  enlaceGoogleCalendar,
} from '../src/services/agenda-ics.ts'

test('Lima es UTC-5 fijo (sin horario de verano)', () => {
  assert.equal(DESPLAZAMIENTO_LIMA_MINUTOS, -300)
})

test('09:00 en Lima sale como 14:00Z el mismo día', () => {
  const utc = citaLimaAUtc('2026-10-21', '09:00')
  assert.equal(aUtcCompacto(utc), '20261021T140000Z')
})

test('20:00 en Lima sale como 01:00Z del día siguiente', () => {
  const utc = citaLimaAUtc('2026-10-21', '20:00')
  assert.equal(aUtcCompacto(utc), '20261022T010000Z')
})

test('medianoche en Lima es 05:00Z el mismo día', () => {
  assert.equal(aUtcCompacto(citaLimaAUtc('2026-10-21', '00:00')), '20261021T050000Z')
})

test('el enlace de Google usa action=TEMPLATE con fechas UTC y Z', () => {
  const url = enlaceGoogleCalendar({
    titulo: 'Pérez, Juan — Limpieza',
    fecha: '2026-10-21',
    horaInicio: '09:00',
    horaFin: '09:30',
    sede: 'Sede principal',
    detalle: 'Cita CIT-0001',
  })
  const u = new URL(url)
  assert.equal(`${u.origin}${u.pathname}`, 'https://calendar.google.com/calendar/render')
  assert.equal(u.searchParams.get('action'), 'TEMPLATE')
  assert.equal(u.searchParams.get('dates'), '20261021T140000Z/20261021T143000Z')
  assert.equal(u.searchParams.get('text'), 'Pérez, Juan — Limpieza')
  assert.equal(u.searchParams.get('location'), 'Sede principal')
  assert.equal(u.searchParams.get('details'), 'Cita CIT-0001')
})

test('el enlace omite ubicación y detalle cuando no hay', () => {
  const url = enlaceGoogleCalendar({
    titulo: 'Cita',
    fecha: '2026-10-21',
    horaInicio: '09:00',
    horaFin: '09:30',
  })
  const u = new URL(url)
  assert.equal(u.searchParams.has('location'), false)
  assert.equal(u.searchParams.has('details'), false)
})

test('horas inválidas se rechazan en lugar de generar un enlace roto', () => {
  assert.throws(() => citaLimaAUtc('2026-10-21', '9:00'), /Hora inválida/)
  assert.throws(() => citaLimaAUtc('2026-10-21', '24:00'), /Hora inválida/)
})
