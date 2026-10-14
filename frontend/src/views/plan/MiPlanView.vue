<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PlanPagoModal from '../../components/plan/PlanPagoModal.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import { formatoMoneda } from '../../services/pagos'
import { obtenerMiPlan, type MiPlan } from '../../services/facturacion'
import { esNoEncontrado, mensajeDeError } from '../../services/errores'
import { formatearFechaUTC } from '../../services/fechas'
import { useSessionStore } from '../../stores/session'

const sesion = useSessionStore()
const router = useRouter()

const plan = ref<MiPlan | null>(null)
const cargando = ref(true)
const error = ref('')
const noExiste = ref(false)
const modalPago = ref(false)
const aviso = ref('')

const puedePagar = computed(() => sesion.puede('billing.manage'))

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  noExiste.value = false
  try {
    plan.value = await obtenerMiPlan()
  } catch (e) {
    if (esNoEncontrado(e)) noExiste.value = true
    else error.value = mensajeDeError(e, 'No se pudo cargar el plan')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

async function revisar(): Promise<void> {
  try {
    plan.value = await obtenerMiPlan()
    if (plan.value.cobroPendiente === null) aviso.value = 'Plan al día: no hay cobros pendientes.'
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo actualizar el estado del plan')
  }
}

async function cerrarModal(mensaje: string): Promise<void> {
  modalPago.value = false
  aviso.value = mensaje
  await revisar()
}

async function alExito(cobroId: string): Promise<void> {
  modalPago.value = false
  await router.push({ name: 'plan-resultado', query: { cobro: cobroId } })
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <CargandoBloque v-if="cargando" texto="Cargando plan…" />
    <EstadoVacio
      v-else-if="noExiste"
      titulo="Sin suscripción"
      detalle="Esta clínica aún no tiene suscripción. Contacte al equipo de plataforma."
    />
    <template v-else-if="plan">
      <AvisoError v-if="error" class="mb-4" :mensaje="error" />
      <p v-if="aviso" role="status" class="mb-4 text-sm text-muted">{{ aviso }}</p>

      <div class="rounded-lg border border-line bg-background p-5">
        <p class="text-xs font-medium uppercase text-muted">Mi plan</p>
        <h1 class="mt-1 text-lg font-semibold text-ink">{{ plan.plan.nombre }}</h1>
        <p class="mt-0.5 font-mono text-xs text-muted">{{ plan.plan.codigo }}</p>

        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt class="text-xs text-muted">Precio / mes</dt>
            <dd class="font-medium text-ink">{{ formatoMoneda(plan.plan.precioMensual) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Estado</dt>
            <dd class="font-medium uppercase text-ink">{{ plan.subscription.estado }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Periodo desde</dt>
            <dd class="font-medium text-ink">{{ formatearFechaUTC(plan.subscription.periodoInicio) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Periodo hasta</dt>
            <dd class="font-medium text-ink">{{ formatearFechaUTC(plan.subscription.periodoFin) }}</dd>
          </div>
        </dl>
      </div>

      <div v-if="plan.cobroPendiente" class="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-5">
        <p class="text-xs font-medium uppercase text-muted">Cobro pendiente</p>
        <p class="mt-2 text-2xl font-semibold text-ink">{{ formatoMoneda(plan.cobroPendiente.monto) }}</p>
        <p class="mt-1 text-xs text-muted">
          Periodo {{ formatearFechaUTC(plan.cobroPendiente.periodoInicio) }} → {{ formatearFechaUTC(plan.cobroPendiente.periodoFin) }}
        </p>
        <button
          v-if="puedePagar"
          type="button"
          class="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          @click="modalPago = true; aviso = ''"
        >
          Pagar el plan
        </button>
        <p v-else class="mt-4 text-xs text-muted">Su rol no tiene permiso para pagar el plan.</p>
      </div>
      <p v-else class="mt-4 rounded-lg border border-line bg-background p-5 text-sm text-muted">
        Plan al día: no hay cobros pendientes.
      </p>

      <div v-if="plan.cobros.length > 0" class="mt-4 rounded-lg border border-line bg-background p-5">
        <h2 class="text-sm font-semibold text-ink">Últimos cobros</h2>
        <ul class="mt-3 space-y-2 text-sm">
          <li v-for="c in plan.cobros" :key="c.id" class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-xs text-muted">{{ formatearFechaUTC(c.periodoInicio) }}</span>
            <span class="font-medium text-ink">{{ formatoMoneda(c.monto) }}</span>
            <span class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
              :class="c.estado === 'pagado' ? 'bg-success/10 text-success' : c.estado === 'pendiente' ? 'bg-warning/10 text-warning' : 'bg-error/10 text-error'">
              {{ c.estado }}
            </span>
          </li>
        </ul>
      </div>

      <PlanPagoModal v-if="modalPago" @cerrar="cerrarModal" @revisar="revisar" @exito="alExito" />
    </template>
  </div>
</template>
