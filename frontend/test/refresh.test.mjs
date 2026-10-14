import assert from 'node:assert/strict'
import { test } from 'node:test'
import axios, { AxiosError } from 'axios'
import { instalarRefresh } from '../src/services/refresh-session.ts'

function rechazo(config, status = 401) {
  return new AxiosError('HTTP rechazado', 'ERR_BAD_REQUEST', config, null,
    { status, data: {}, headers: {}, config })
}
function montar(ruta, { fallaRefresh = 0, protegidoSiempreFalla = false } = {}) {
  let token = 'anterior'
  let refresh = 0
  let salidas = 0
  const urls = []
  const adapter = async (config) => {
    urls.push(config.url)
    if (config.url === ruta) {
      refresh++
      assert.equal(config.withCredentials, true)
      assert.equal(config.headers.Authorization, undefined)
      assert.equal(config.headers['X-Tenant-Id'], undefined)
      await new Promise((resolve) => setTimeout(resolve, 10))
      if (fallaRefresh) throw rechazo(config, fallaRefresh)
      return { status: 200, data: { access_token: 'nuevo' }, config, headers: {} }
    }
    if (config.headers.Authorization !== 'Bearer nuevo' || protegidoSiempreFalla) throw rechazo(config)
    return { status: 200, data: { ok: true }, config, headers: {} }
  }
  const cliente = axios.create({ baseURL: '/api', timeout: 15000, adapter })
  cliente.interceptors.request.use((c) => { c.headers.Authorization = `Bearer ${token}`; return c })
  instalarRefresh(cliente, { ruta, leerToken: () => token, guardarToken: (t) => { token = t },
    expirar: () => { salidas++; token = '' } })
  return { cliente, urls, get refresh() { return refresh }, get token() { return token }, get salidas() { return salidas } }
}
test('tres 401 concurrentes comparten un refresh y reintentan con el nuevo token', async () => {
  const e = montar('/auth/refresh')
  const respuestas = await Promise.all([e.cliente.get('/pacientes'), e.cliente.get('/pagos'), e.cliente.get('/citas')])
  assert.ok(respuestas.every((r) => r.status === 200))
  assert.equal(e.refresh, 1)
  assert.equal(e.token, 'nuevo')
  assert.equal(e.salidas, 0)
})
test('plataforma utiliza su propio refresh, sin tenant ni Bearer', async () => {
  const e = montar('/platform/auth/refresh')
  await e.cliente.get('/platform/tenants')
  assert.equal(e.refresh, 1)
  assert.ok(!e.urls.includes('/auth/refresh'))
})
test('login, MFA y 401 silenciosos de Izipay no provocan refresh', async () => {
  const e = montar('/auth/refresh')
  await assert.rejects(e.cliente.post('/auth/login'))
  await assert.rejects(e.cliente.post('/platform/auth/mfa/verify'))
  await assert.rejects(e.cliente.post('/pagos/id/izipay/validar', {}, { silencioso: true }))
  assert.equal(e.refresh, 0)
  assert.equal(e.salidas, 0)
})
test('refresh inválido cierra la sesión, error temporal la conserva y el reintento no entra en bucle', async () => {
  const invalida = montar('/auth/refresh', { fallaRefresh: 401 })
  await assert.rejects(invalida.cliente.get('/pacientes'))
  assert.equal(invalida.salidas, 1)
  const temporal = montar('/auth/refresh', { fallaRefresh: 503 })
  await assert.rejects(temporal.cliente.get('/pacientes'))
  assert.equal(temporal.salidas, 0)
  const bucle = montar('/auth/refresh', { protegidoSiempreFalla: true })
  await assert.rejects(bucle.cliente.get('/pacientes'))
  assert.equal(bucle.refresh, 1)
  assert.equal(bucle.salidas, 1)
})
