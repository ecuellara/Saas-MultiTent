<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import { formatoMoneda } from '../../services/pagos'
import { obtenerMiPlan, type CobroResumen } from '../../services/facturacion'
import { mensajeDeError } from '../../services/errores'

const router = useRouter()
const route = useRoute()
const cobroId = typeof route.query.cobro === 'string' ? route.query.cobro : ''
const cobro = ref<CobroResumen | null>(null)
const sinCobro = ref(false)
const consultando = ref(false)
const error = ref('')
const esperaAgotada = ref(false)
const confirmado = computed(() => cobro.value?.estado === 'pagado')
let activo = true
let intentos = 0
let temporizador: ReturnType<typeof window.setTimeout> | undefined

function detenerConsulta(): void {
  window.clearTimeout(temporizador)
  temporizador = undefined
}

async function consultar(): Promise<void> {
  if (!activo || consultando.value || !cobroId) return
  detenerConsulta()
  consultando.value = true
  error.value = ''
  try {
    // Única fuente del estado: el cobro persistido. La pantalla JAMÁS marca
    // el plan como pagado; eso solo lo hace la IPN en el servidor.
    const plan = await obtenerMiPlan()
    if (!activo) return
    const actual = plan.cobros.find((c) => c.id === cobroId) ?? null
    cobro.value = actual
    sinCobro.value = actual === null
    intentos++
    if (!confirmado.value && !sinCobro.value) {
      if (intentos < 16) temporizador = window.setTimeout(() => void consultar(), 2000)
      else esperaAgotada.value = true
    }
  } catch (e) {
    if (!activo) return
    error.value = mensajeDeError(e, 'No se pudo consultar la confirmación del pago')
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
    <h1 class="mb-4 text-lg font-semibold text-ink">Resultado del pago del plan</h1>
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />
    <CargandoBloque v-else-if="!cobro && !sinCobro && consultando" texto="Consultando confirmación del pago…" />
    <p v-else-if="sinCobro" class="rounded-lg border border-line bg-background p-5 text-sm text-muted">
      Ese cobro no pertenece a esta clínica o ya no existe.
    </p>
    <div v-else-if="cobro" class="rounded-lg border border-line bg-background p-5">
      <div role="status" aria-live="polite">
        <h2 class="text-lg font-semibold" :class="confirmado ? 'text-success' : 'text-warning'">
          {{ confirmado ? 'Plan pagado' : 'Pago pendiente de confirmar' }}
        </h2>
        <p class="mt-2 text-sm text-muted">
          <template v-if="confirmado">El servidor confirmó el pago y el periodo quedó extendido.</template>
          <template v-else>La confirmación aún no figura en el servidor. Estamos esperando la notificación de Izipay.</template>
        </p>
        <p v-if="esperaAgotada && !confirmado" class="mt-2 text-sm text-muted">
          La confirmación está demorando. Puede actualizar el estado más tarde; no repita el cobro mientras se concilia la operación.
        </p>
      </div>
      <dl class="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div><dt class="text-xs text-muted">Monto</dt><dd class="text-ink">{{ formatoMoneda(cobro.monto) }}</dd></div>
        <div><dt class="text-xs text-muted">Estado</dt><dd class="uppercase text-ink">{{ cobro.estado }}</dd></div>
        <div><dt class="text-xs text-muted">Moneda</dt><dd class="text-ink">{{ cobro.moneda }}</dd></div>
      </dl>
    </div>
    <div class="mt-4 flex flex-wrap gap-2">
      <button v-if="!confirmado && !sinCobro" type="button" :disabled="consultando"
        class="rounded-md border border-line px-3 py-2 text-sm text-ink disabled:opacity-60" @click="actualizar">
        {{ consultando ? 'Consultando…' : 'Actualizar estado' }}
      </button>
      <button type="button" class="rounded-md bg-primary px-3 py-2 text-sm text-white"
        @click="router.push({ name: 'mi-plan' })">Volver a Mi plan</button>
    </div>
  </div>
</template>
