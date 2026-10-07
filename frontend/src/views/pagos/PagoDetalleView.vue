<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AbonoModal from '../../components/pagos/AbonoModal.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import ModalConfirmar from '../../components/ui/ModalConfirmar.vue'
import { obtenerPaciente } from '../../services/pacientes'
import {
  anularPago,
  claseEstadoPago,
  etiquetaEstadoPago,
  formatoMoneda,
  obtenerPago,
  type Pago,
} from '../../services/pagos'
import { esNoEncontrado, mensajeDeError } from '../../services/errores'
import { formatearFechaUTC } from '../../services/fechas'
import { useSessionStore } from '../../stores/session'

const sesion = useSessionStore()
const router = useRouter()
const route = useRoute()
const id = String(route.params.id ?? '')

const pago = ref<Pago | null>(null)
const paciente = ref('')
const cargando = ref(true)
const error = ref('')
const noExiste = ref(false)
const modalAbono = ref(false)
const porAnular = ref(false)
const ocupada = ref(false)

const puedeEscribir = computed(() => sesion.puede('payments.write'))
const puedeAnular = computed(() => sesion.puede('payments.cancel'))
const conSaldo = computed(
  () => pago.value !== null && (pago.value.estado === 'pendiente' || pago.value.estado === 'parcial'),
)

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  noExiste.value = false
  try {
    const p = await obtenerPago(id)
    pago.value = p
    if (p.pacienteId) {
      try {
        const pac = await obtenerPaciente(p.pacienteId)
        paciente.value = `${pac.apellidos}, ${pac.nombres}`
      } catch {
        paciente.value = ''
      }
    }
  } catch (e) {
    // 404 también significa «es de otra clínica»: no se distingue.
    if (esNoEncontrado(e)) noExiste.value = true
    else error.value = mensajeDeError(e, 'No se pudo cargar el pago')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

async function alAbonar(actualizado: Pago): Promise<void> {
  modalAbono.value = false
  pago.value = actualizado
}

async function confirmarAnulacion(): Promise<void> {
  if (!pago.value) return
  ocupada.value = true
  error.value = ''
  try {
    pago.value = await anularPago(pago.value.id)
    porAnular.value = false
  } catch (e) {
    // Aquí llegan las reglas del backend: ya anulado, totalmente pagado o
    // carrera concurrente (409 → reintentar recargando).
    error.value = mensajeDeError(e, 'No se pudo anular el pago')
  } finally {
    ocupada.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <button class="mb-3 text-xs text-muted hover:text-ink" @click="router.push({ name: 'pagos' })">
      ← Volver a pagos
    </button>

    <CargandoBloque v-if="cargando" texto="Cargando pago…" />
    <EstadoVacio
      v-else-if="noExiste"
      titulo="Pago no encontrado"
      detalle="Puede que sea de otra clínica o que ya no exista."
    />
    <template v-else-if="pago">
      <AvisoError v-if="error" class="mb-4" :mensaje="error" />

      <div class="rounded-lg border border-line bg-background p-5" :class="pago.estado === 'anulado' && 'opacity-60'">
        <div class="flex flex-wrap items-center gap-2">
          <p class="font-mono text-xs text-muted">{{ pago.codigoRecibo }}</p>
          <span
            class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
            :class="claseEstadoPago(pago.estado)"
          >
            {{ etiquetaEstadoPago(pago.estado) }}
          </span>
          <span class="ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase text-muted">
            {{ pago.tipo }}
          </span>
        </div>

        <h1 class="mt-2 text-lg font-semibold text-ink">{{ pago.concepto }}</h1>
        <p v-if="paciente" class="mt-0.5 text-sm text-muted">{{ paciente }}</p>

        <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt class="text-xs text-muted">Total</dt>
            <dd class="font-medium text-ink">{{ formatoMoneda(pago.montoTotal) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Pagado</dt>
            <dd class="font-medium text-ink">{{ formatoMoneda(pago.montoPagado) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Saldo</dt>
            <dd class="font-medium text-ink">{{ formatoMoneda(pago.saldo) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Fecha</dt>
            <dd class="font-medium text-ink">{{ formatearFechaUTC(pago.fecha) }}</dd>
          </div>
        </dl>

        <p v-if="pago.metodoPago" class="mt-3 text-xs text-muted">
          Método: {{ pago.metodoPago }}
        </p>
        <p v-if="pago.observacion" class="mt-1 text-xs text-muted">{{ pago.observacion }}</p>

        <div v-if="conSaldo" class="mt-4 flex flex-wrap gap-2">
          <button
            v-if="puedeEscribir"
            type="button"
            class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark"
            @click="modalAbono = true"
          >
            Registrar abono
          </button>
          <button
            v-if="puedeAnular"
            type="button"
            class="rounded-md border border-line px-3 py-1.5 text-sm text-error hover:bg-error/10"
            @click="porAnular = true"
          >
            Anular
          </button>
        </div>
        <p v-else-if="pago.estado === 'pagado'" class="mt-4 text-xs text-muted">
          Saldado. Un pago totalmente pagado ya no se puede anular.
        </p>
      </div>

      <AbonoModal
        v-if="modalAbono && pago"
        :pago="pago"
        @actualizado="alAbonar"
        @cerrar="modalAbono = false"
      />

      <ModalConfirmar
        v-if="porAnular"
        titulo="Anular el pago"
        mensaje="El pago quedará como anulado y ya no aceptará abonos."
        texto-confirmar="Anular pago"
        peligro
        :ocupado="ocupada"
        @confirmar="confirmarAnulacion"
        @cancelar="porAnular = false"
      />
    </template>
  </div>
</template>
