<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import { formatoMoneda, obtenerPago, type Pago } from '../../services/pagos'
import { esNoEncontrado, mensajeDeError } from '../../services/errores'

const router = useRouter()
const route = useRoute()
const id = String(route.params.id ?? '')
const pago = ref<Pago | null>(null)
const consultando = ref(false)
const error = ref('')
const noExiste = ref(false)
const esperaAgotada = ref(false)
const confirmado = computed(() => pago.value?.estado === 'pagado')
const anulado = computed(() => pago.value?.estado === 'anulado')
let activo = true
let intentos = 0
let temporizador: ReturnType<typeof window.setTimeout> | undefined

function detenerConsulta(): void {
  window.clearTimeout(temporizador)
  temporizador = undefined
}

async function consultar(): Promise<void> {
  if (!activo || consultando.value) return
  detenerConsulta()
  consultando.value = true
  error.value = ''
  try {
    // Única fuente del estado: GET del pago persistido. No hay abonos en esta vista.
    const actualizado = await obtenerPago(id)
    if (!activo) return
    pago.value = actualizado
    intentos++
    if (!confirmado.value && !anulado.value) {
      if (intentos < 16) temporizador = window.setTimeout(() => void consultar(), 2000)
      else esperaAgotada.value = true
    }
  } catch (e) {
    if (!activo) return
    if (esNoEncontrado(e)) noExiste.value = true
    else error.value = mensajeDeError(e, 'No se pudo consultar la confirmación del pago')
  } finally {
    if (activo) consultando.value = false
  }
}

async function actualizar(): Promise<void> {
  if (consultando.value) return
  intentos = 0
  esperaAgotada.value = false
  await consultar()
}

onMounted(consultar)
onBeforeUnmount(() => {
  activo = false
  detenerConsulta()
})
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <h1 class="mb-4 text-lg font-semibold text-ink">Resultado del pago en línea</h1>
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />
    <EstadoVacio v-if="noExiste" titulo="Pago no encontrado" detalle="Puede que sea de otra clínica o que ya no exista." />
    <CargandoBloque v-else-if="!pago && consultando" texto="Consultando confirmación del pago…" />
    <div v-else-if="pago" class="rounded-lg border border-line bg-background p-5">
      <div role="status" aria-live="polite">
        <h2 class="text-lg font-semibold" :class="confirmado ? 'text-success' : anulado ? 'text-error' : 'text-warning'">
          {{ confirmado ? 'Pago confirmado' : anulado ? 'Pago anulado' : 'Pago pendiente de confirmar' }}
        </h2>
        <p class="mt-2 text-sm text-muted">
          <template v-if="confirmado">El servidor confirmó el pago y el saldo está actualizado.</template>
          <template v-else-if="anulado">El pago figura como anulado. Consulte la conciliación de la operación con la clínica.</template>
          <template v-else>La confirmación aún no figura en el servidor. Estamos esperando la notificación de Izipay.</template>
        </p>
        <p v-if="esperaAgotada && !confirmado && !anulado" class="mt-2 text-sm text-muted">
          La confirmación está demorando. Puede actualizar el estado más tarde; no repita el cobro mientras se concilia la operación.
        </p>
      </div>
      <p class="mt-5 font-mono text-xs text-muted">{{ pago.codigoRecibo }}</p>
      <p class="mt-1 font-medium text-ink">{{ pago.concepto }}</p>
      <dl class="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div><dt class="text-xs text-muted">Total</dt><dd class="text-ink">{{ formatoMoneda(pago.montoTotal) }}</dd></div>
        <div><dt class="text-xs text-muted">Pagado</dt><dd class="text-ink">{{ formatoMoneda(pago.montoPagado) }}</dd></div>
        <div><dt class="text-xs text-muted">Saldo</dt><dd class="text-ink">{{ formatoMoneda(pago.saldo) }}</dd></div>
      </dl>
    </div>
    <div class="mt-4 flex flex-wrap gap-2">
      <button v-if="!confirmado && !anulado && !noExiste" type="button" :disabled="consultando"
        class="rounded-md border border-line px-3 py-2 text-sm text-ink disabled:opacity-60" @click="actualizar">
        {{ consultando ? 'Consultando…' : 'Actualizar estado' }}
      </button>
      <button type="button" class="rounded-md bg-primary px-3 py-2 text-sm text-white"
        @click="router.push({ name: 'pago-detalle', params: { id } })">Ver detalle del pago</button>
      <button type="button" class="rounded-md border border-line px-3 py-2 text-sm text-ink"
        @click="router.push({ name: 'pagos' })">Volver a pagos</button>
    </div>
  </div>
</template>
