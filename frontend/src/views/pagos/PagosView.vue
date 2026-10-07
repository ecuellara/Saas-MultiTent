<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PagoFormModal from '../../components/pagos/PagoFormModal.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import { listarPacientes, type Paciente } from '../../services/pacientes'
import {
  claseEstadoPago,
  etiquetaEstadoPago,
  formatoMoneda,
  listarPagos,
  num,
  type EstadoPago,
  type Pago,
} from '../../services/pagos'
import { mensajeDeError } from '../../services/errores'
import { formatearFechaUTC } from '../../services/fechas'
import { useSessionStore } from '../../stores/session'

/**
 * Listado de pagos.
 *
 * Si se llega con `?cita=<id>` (botón «Cobrar» de la agenda), se abre el
 * formulario ya vinculado a esa cita: así se cierra el circuito
 * cita → cobro sin rebuscar al paciente.
 */
const sesion = useSessionStore()
const router = useRouter()
const route = useRoute()

const pagos = ref<Pago[]>([])
const pacientes = ref<Paciente[]>([])
const cargando = ref(true)
const error = ref('')
const filtroEstado = ref<'' | EstadoPago>('')
const busqueda = ref('')
const modalNuevo = ref(false)
const citaPreseleccionada = ref<string | undefined>(undefined)

const puedeEscribir = computed(() => sesion.puede('payments.write'))

const mapaPacientes = computed(() => new Map(pacientes.value.map((p) => [p.id, p])))

function nombrePaciente(id: string | null): string {
  if (!id) return '—'
  const p = mapaPacientes.value.get(id)
  return p ? `${p.apellidos}, ${p.nombres}` : 'Paciente'
}

const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  return pagos.value.filter((p) => {
    if (filtroEstado.value && p.estado !== filtroEstado.value) return false
    if (!q) return true
    return (
      p.concepto.toLowerCase().includes(q) ||
      p.codigoRecibo.toLowerCase().includes(q) ||
      nombrePaciente(p.pacienteId).toLowerCase().includes(q)
    )
  })
})

/** Lo que falta por cobrar (pendientes + parciales). */
const porCobrar = computed(() =>
  pagos.value
    .filter((p) => p.estado === 'pendiente' || p.estado === 'parcial')
    .reduce((s, p) => s + num(p.saldo), 0),
)

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const [l, p] = await Promise.all([listarPagos(), listarPacientes()])
    pagos.value = l
    pacientes.value = p
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar los pagos')
  } finally {
    cargando.value = false
  }
}

function abrirDesdeAgenda(): void {
  const citaId = route.query.cita
  if (typeof citaId === 'string' && citaId.length > 0) {
    citaPreseleccionada.value = citaId
    modalNuevo.value = true
    // Se limpia el query para que recargar no reabra el formulario.
    void router.replace({ query: {} })
  } else {
    citaPreseleccionada.value = undefined
  }
}

onMounted(async () => {
  await cargar()
  abrirDesdeAgenda()
})
watch(() => route.query.cita, abrirDesdeAgenda)

async function alCrear(): Promise<void> {
  modalNuevo.value = false
  citaPreseleccionada.value = undefined
  await cargar()
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-ink">Pagos</h2>
        <p class="mt-0.5 text-sm text-muted">{{ formatoMoneda(porCobrar) }} por cobrar</p>
      </div>
      <button
        v-if="puedeEscribir"
        type="button"
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
        @click="modalNuevo = true"
      >
        Nuevo pago
      </button>
    </header>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <input
        v-model="busqueda"
        type="text"
        placeholder="Buscar por concepto, recibo o paciente…"
        class="min-w-0 flex-1 rounded-md border border-line bg-background px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <select
        v-model="filtroEstado"
        class="rounded-md border border-line bg-background px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        aria-label="Filtrar por estado"
      >
        <option value="">Todos</option>
        <option value="pendiente">Pendiente</option>
        <option value="parcial">Parcial</option>
        <option value="pagado">Pagado</option>
        <option value="anulado">Anulado</option>
      </select>
    </div>

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando pagos…" />

    <EstadoVacio
      v-else-if="filtrados.length === 0"
      class="mt-4"
      titulo="Sin pagos"
      :detalle="busqueda || filtroEstado ? 'Ningún pago coincide con el filtro.' : 'Registra el primero con «Nuevo pago».'"
    />

    <ul v-else class="mt-4 space-y-2">
      <li
        v-for="p in filtrados"
        :key="p.id"
        class="rounded-lg border border-line bg-background p-4"
        :class="p.estado === 'anulado' && 'opacity-60'"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-xs text-muted">{{ p.codigoRecibo }}</span>
              <span
                class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                :class="claseEstadoPago(p.estado)"
              >
                {{ etiquetaEstadoPago(p.estado) }}
              </span>
            </p>
            <button
              class="mt-1 block truncate text-left text-sm font-medium text-ink hover:text-primary"
              @click="router.push({ name: 'pago-detalle', params: { id: p.id } })"
            >
              {{ p.concepto }}
            </button>
            <p class="mt-0.5 text-xs text-muted">
              {{ nombrePaciente(p.pacienteId) }} · {{ formatearFechaUTC(p.fecha) }}
              <span v-if="p.metodoPago"> · {{ p.metodoPago }}</span>
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p class="text-sm font-medium text-ink">{{ formatoMoneda(p.montoTotal) }}</p>
            <p v-if="p.estado === 'pendiente' || p.estado === 'parcial'" class="text-xs text-muted">
              Saldo {{ formatoMoneda(p.saldo) }}
            </p>
          </div>
        </div>
      </li>
    </ul>

    <PagoFormModal
      v-if="modalNuevo"
      :cita-id-inicial="citaPreseleccionada"
      @creada="alCrear"
      @cerrar="modalNuevo = false; citaPreseleccionada = undefined"
    />
  </div>
</template>
