<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../../stores/session'
import { escucharCierreSesion } from '../../services/canal-sesion'
import ModalBase from '../ui/ModalBase.vue'

/**
 * Cierre de sesión por inactividad.
 *
 * La última actividad vive en `localStorage`, no en memoria: así varias
 * pestañas comparten el mismo reloj y solo se cierra la sesión cuando NINGUNA
 * ha tenido actividad en 30 minutos. Un minuto antes se avisa y se puede
 * continuar; el cierre de una pestaña (por inactividad o por «Salir») lleva a
 * las demás al login al instante por `storage` y `BroadcastChannel`.
 */
const CLAVE_ACTIVIDAD = 'ultimaActividad'
const LIMITE_MS = 30 * 60 * 1000
const AVISO_MS = 60 * 1000
const INTERVALO_MS = 1000
/** Los eventos de ratón/scroll son muy frecuentes: no escribir en cada uno. */
const THROTTLE_MS = 5000

const router = useRouter()
const sesion = useSessionStore()

const avisando = ref(false)
const segundosRestantes = ref(Math.ceil(AVISO_MS / 1000))

let intervalo: number | undefined
let ultimaEscritura = 0
let cerrando = false
let dejarDeEscucharCanal: (() => void) | null = null

function leerUltimaActividad(): number {
  const guardada = Number(localStorage.getItem(CLAVE_ACTIVIDAD))
  return Number.isFinite(guardada) && guardada > 0 ? guardada : Date.now()
}

function escribirActividad(): void {
  ultimaEscritura = Date.now()
  localStorage.setItem(CLAVE_ACTIVIDAD, String(ultimaEscritura))
}

/** Actividad del usuario en esta pestaña (reinicia el reloj compartido). */
function alHaberActividad(): void {
  if (!sesion.autenticado || cerrando) return
  if (Date.now() - ultimaEscritura < THROTTLE_MS) return
  escribirActividad()
  avisando.value = false
}

function continuar(): void {
  escribirActividad()
  avisando.value = false
}

async function cerrarPorInactividad(): Promise<void> {
  if (cerrando) return
  cerrando = true
  avisando.value = false
  await sesion.cerrarSesion()
  localStorage.removeItem(CLAVE_ACTIVIDAD)
  if (router.currentRoute.value.name !== 'login') {
    await router.replace({ name: 'login', query: { expirada: '1' } })
  }
  cerrando = false
}

/** El panel de plataforma tiene sesión propia: no se cierra desde aquí. */
function enPlataforma(): boolean {
  return router.currentRoute.value.path.startsWith('/admin')
}

function revisar(): void {
  if (!sesion.autenticado || cerrando || enPlataforma()) {
    avisando.value = false
    return
  }
  const restante = LIMITE_MS - (Date.now() - leerUltimaActividad())
  if (restante <= 0) {
    void cerrarPorInactividad()
    return
  }
  if (restante <= AVISO_MS) {
    avisando.value = true
    segundosRestantes.value = Math.max(0, Math.ceil(restante / 1000))
  } else {
    avisando.value = false
  }
}

/** Otra pestaña cerró sesión: se borra el token y se va al login sin esperar. */
function alCambiarAlmacen(evento: StorageEvent): void {
  if (evento.key !== 'token' || evento.newValue !== null || cerrando) return
  alCerrarRemoto()
}

function alCerrarRemoto(): void {
  if (cerrando || enPlataforma()) return
  cerrando = true
  avisando.value = false
  sesion.limpiar()
  if (router.currentRoute.value.name !== 'login') {
    void router.replace({ name: 'login' })
  }
  cerrando = false
}

const EVENTOS_ACTIVIDAD = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const

function iniciar(): void {
  if (intervalo !== undefined) return
  escribirActividad()
  intervalo = window.setInterval(revisar, INTERVALO_MS)
  window.addEventListener('storage', alCambiarAlmacen)
  for (const evento of EVENTOS_ACTIVIDAD) {
    window.addEventListener(evento, alHaberActividad, { passive: true })
  }
}

function detener(): void {
  if (intervalo !== undefined) {
    window.clearInterval(intervalo)
    intervalo = undefined
  }
  window.removeEventListener('storage', alCambiarAlmacen)
  for (const evento of EVENTOS_ACTIVIDAD) {
    window.removeEventListener(evento, alHaberActividad)
  }
  avisando.value = false
}

watch(
  () => sesion.autenticado,
  (activo) => {
    if (activo) iniciar()
    else detener()
  },
)

onMounted(() => {
  dejarDeEscucharCanal = escucharCierreSesion(alCerrarRemoto)
  if (sesion.autenticado) iniciar()
})

onUnmounted(() => {
  detener()
  dejarDeEscucharCanal?.()
  dejarDeEscucharCanal = null
})
</script>

<template>
  <ModalBase v-if="avisando" titulo="¿Seguir conectado?" ancho="sm" @cerrar="continuar">
    <p class="text-sm text-muted">
      Tu sesión se cerrará por inactividad en
      <strong class="text-ink">{{ segundosRestantes }} s</strong>.
    </p>

    <template #pie>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft"
          @click="cerrarPorInactividad"
        >
          Cerrar sesión
        </button>
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark"
          @click="continuar"
        >
          Continuar
        </button>
      </div>
    </template>
  </ModalBase>
</template>
