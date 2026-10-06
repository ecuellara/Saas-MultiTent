<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import CitaFormModal from '../../components/citas/CitaFormModal.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import ModalConfirmar from '../../components/ui/ModalConfirmar.vue'
import { listarTratamientos, type Tratamiento } from '../../services/catalogos'
import {
  actualizarCita,
  cancelarCita,
  claseEstado,
  etiquetaEstado,
  listarCitas,
  type Cita,
} from '../../services/citas'
import { mensajeDeError } from '../../services/errores'
import { fechaLarga, hora12, hoyLocal, sumarDias } from '../../services/fechas'
import { listarPacientes, type Paciente } from '../../services/pacientes'
import { useSessionStore } from '../../stores/session'

/**
 * Agenda del día.
 *
 * `GET /citas?fecha=` devuelve las citas con `pacienteId`, no con el nombre, así
 * que la vista carga también pacientes y tratamientos para resolverlos. Cuando el
 * número de pacientes crezca, esto se mueve al servidor con un `include`.
 */
const sesion = useSessionStore()

const fecha = ref(hoyLocal())
const citas = ref<Cita[]>([])
const pacientes = ref<Paciente[]>([])
const tratamientos = ref<Tratamiento[]>([])
const cargando = ref(true)
const error = ref('')
const ocupada = ref('')

const modalNueva = ref(false)
const porCancelar = ref<Cita | null>(null)

const puedeEscribir = computed(() => sesion.puede('appointments.write'))

const mapaPacientes = computed(() => new Map(pacientes.value.map((p) => [p.id, p])))
const mapaTratamientos = computed(() => new Map(tratamientos.value.map((t) => [t.id, t.nombre])))

function nombrePaciente(id: string): string {
  const p = mapaPacientes.value.get(id)
  return p ? `${p.apellidos}, ${p.nombres}` : 'Paciente'
}

const resumen = computed(() => ({
  total: citas.value.length,
  pendientes: citas.value.filter((c) => c.estado === 'pendiente').length,
  canceladas: citas.value.filter((c) => c.estado === 'cancelada').length,
}))

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const [c, p, t] = await Promise.all([
      listarCitas(fecha.value),
      listarPacientes(),
      listarTratamientos(),
    ])
    citas.value = c
    pacientes.value = p
    tratamientos.value = t
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar la agenda')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)
watch(fecha, cargar)

function mover(dias: number): void {
  fecha.value = sumarDias(fecha.value, dias)
}

async function cambiarEstado(cita: Cita, estado: Cita['estado']): Promise<void> {
  ocupada.value = cita.id
  error.value = ''
  try {
    await actualizarCita(cita.id, { estado })
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cambiar el estado de la cita')
  } finally {
    ocupada.value = ''
  }
}

async function confirmarCancelacion(): Promise<void> {
  if (!porCancelar.value) return
  ocupada.value = porCancelar.value.id
  error.value = ''
  try {
    await cancelarCita(porCancelar.value.id)
    porCancelar.value = null
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cancelar la cita')
  } finally {
    ocupada.value = ''
  }
}

async function alCrear(): Promise<void> {
  modalNueva.value = false
  await cargar()
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-ink">Agenda</h2>
        <p class="mt-0.5 text-sm capitalize text-muted">{{ fechaLarga(fecha) }}</p>
      </div>
      <button
        v-if="puedeEscribir"
        type="button"
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
        @click="modalNueva = true"
      >
        Nueva cita
      </button>
    </header>

    <!-- Navegación por días -->
    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-background-soft"
        aria-label="Día anterior"
        @click="mover(-1)"
      >
        ←
      </button>
      <input
        v-model="fecha"
        type="date"
        class="rounded-md border border-line bg-background px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <button
        type="button"
        class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-background-soft"
        aria-label="Día siguiente"
        @click="mover(1)"
      >
        →
      </button>
      <button
        type="button"
        class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-background-soft"
        @click="fecha = hoyLocal()"
      >
        Hoy
      </button>

      <p class="ml-auto text-xs text-muted">
        {{ resumen.total }} citas · {{ resumen.pendientes }} por confirmar<span
          v-if="resumen.canceladas"
        >
          · {{ resumen.canceladas }} canceladas</span
        >
      </p>
    </div>

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando agenda…" />

    <EstadoVacio
      v-else-if="citas.length === 0"
      class="mt-4"
      titulo="Sin citas para este día"
      :detalle="
        puedeEscribir
          ? 'Crea la primera cita con «Nueva cita».'
          : 'No tienes permiso para agendar citas.'
      "
    />

    <ul v-else class="mt-4 space-y-2">
      <li
        v-for="cita in citas"
        :key="cita.id"
        class="rounded-lg border border-line bg-background p-4"
        :class="cita.estado === 'cancelada' && 'opacity-60'"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-sm text-muted">
                {{ hora12(cita.horaInicio) }} – {{ hora12(cita.horaFin) }}
              </span>
              <span
                class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                :class="claseEstado(cita.estado)"
              >
                {{ etiquetaEstado(cita.estado) }}
              </span>
            </p>
            <p class="mt-1 truncate text-sm font-medium text-ink">
              {{ nombrePaciente(cita.pacienteId) }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              <span v-if="cita.tratamientoId">
                {{ mapaTratamientos.get(cita.tratamientoId) ?? 'Tratamiento' }}
              </span>
              <span v-else>Sin tratamiento</span>
              <span class="ml-2 font-mono">{{ cita.token }}</span>
            </p>
            <p v-if="cita.observacion" class="mt-1 text-xs text-muted">{{ cita.observacion }}</p>
          </div>

          <div v-if="puedeEscribir" class="flex shrink-0 flex-wrap gap-1">
            <button
              v-if="cita.estado === 'pendiente'"
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft disabled:opacity-60"
              :disabled="ocupada === cita.id"
              @click="cambiarEstado(cita, 'confirmada')"
            >
              Confirmar
            </button>
            <button
              v-if="cita.estado === 'confirmada' || cita.estado === 'recordatorio_enviado'"
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-success hover:bg-success/10 disabled:opacity-60"
              :disabled="ocupada === cita.id"
              @click="cambiarEstado(cita, 'realizada')"
            >
              Realizada
            </button>
            <button
              v-if="cita.estado === 'confirmada' || cita.estado === 'recordatorio_enviado'"
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-background-soft disabled:opacity-60"
              :disabled="ocupada === cita.id"
              @click="cambiarEstado(cita, 'no_asistio')"
            >
              No asistió
            </button>
            <button
              v-if="cita.estado !== 'cancelada' && cita.estado !== 'realizada'"
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-60"
              :disabled="ocupada === cita.id"
              @click="porCancelar = cita"
            >
              Cancelar
            </button>
          </div>
        </div>
      </li>
    </ul>

    <CitaFormModal
      v-if="modalNueva"
      :fecha-inicial="fecha"
      @creada="alCrear"
      @cerrar="modalNueva = false"
    />

    <ModalConfirmar
      v-if="porCancelar"
      titulo="Cancelar la cita"
      :mensaje="`Se cancelará la cita de ${nombrePaciente(porCancelar.pacienteId)} a las ${hora12(porCancelar.horaInicio)}. La cita no se borra: queda como cancelada.`"
      texto-confirmar="Cancelar cita"
      peligro
      :ocupado="ocupada === porCancelar.id"
      @confirmar="confirmarCancelacion"
      @cancelar="porCancelar = null"
    />
  </div>
</template>
