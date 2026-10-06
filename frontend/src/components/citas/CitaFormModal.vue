<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  listarMiembros,
  listarSedes,
  listarTratamientos,
  type Miembro,
  type Sede,
  type Tratamiento,
} from '../../services/catalogos'
import { crearCita, type Cita } from '../../services/citas'
import { mensajeDeError } from '../../services/errores'
import { deInputFecha, sumarMinutos } from '../../services/fechas'
import { listarPacientes, type Paciente } from '../../services/pacientes'
import { useSessionStore } from '../../stores/session'
import AvisoError from '../ui/AvisoError.vue'
import ModalBase from '../ui/ModalBase.vue'
import SelectorEntidad from '../ui/SelectorEntidad.vue'

const props = withDefaults(
  defineProps<{
    /** Día preseleccionado (`aaaa-mm-dd`). */
    fechaInicial: string
    /** Hora preseleccionada (`HH:MM`). */
    horaInicial?: string
  }>(),
  { horaInicial: '09:00' },
)

const emit = defineEmits<{ creada: [Cita]; cerrar: [] }>()

const sesion = useSessionStore()

const form = reactive({
  pacienteId: '',
  tratamientoId: '',
  sedeId: '',
  dentistaId: '',
  fecha: props.fechaInicial,
  horaInicio: props.horaInicial,
  horaFin: sumarMinutos(props.horaInicial, 30),
  observacion: '',
})

const pacientes = ref<Paciente[]>([])
const tratamientos = ref<Tratamiento[]>([])
const sedes = ref<Sede[]>([])
const miembros = ref<Miembro[]>([])
const cargando = ref(true)
const guardando = ref(false)
const error = ref('')

/** `GET /memberships` exige `members.manage`: sin permiso no se ofrece el selector. */
const puedeVerEquipo = computed(() => sesion.puede('members.manage'))

onMounted(async () => {
  try {
    const [p, t, s] = await Promise.all([listarPacientes(), listarTratamientos(), listarSedes()])
    pacientes.value = p
    tratamientos.value = t
    sedes.value = s
    // Sede por defecto: la del usuario, o la principal.
    form.sedeId = sesion.activa?.sedeId ?? s.find((x) => x.esPrincipal)?.id ?? s[0]?.id ?? ''
    if (puedeVerEquipo.value) {
      // El backend responde 403 si no hay permiso: se degrada sin ruido.
      miembros.value = await listarMiembros().catch(() => [])
    }
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar los catálogos')
  } finally {
    cargando.value = false
  }
})

const opcionesPacientes = computed(() =>
  pacientes.value.map((p) => ({
    valor: p.id,
    etiqueta: `${p.apellidos}, ${p.nombres}${p.numDoc ? ` · ${p.tipoDoc} ${p.numDoc}` : ''}`,
  })),
)

const opcionesTratamientos = computed(() =>
  tratamientos.value.map((t) => ({
    valor: t.id,
    etiqueta: `${t.nombre} · ${t.duracionMin} min`,
  })),
)

const opcionesSedes = computed(() =>
  sedes.value.map((s) => ({ valor: s.id, etiqueta: s.nombre })),
)

const opcionesDentistas = computed(() =>
  miembros.value.map((m) => ({
    valor: m.id,
    etiqueta: `${m.user.nombre} · ${m.role.codigo}`,
  })),
)

/**
 * Al elegir tratamiento se ajusta la hora de fin con su duración: es el dato que
 * ya tiene la clínica y evita teclear dos horas en cada cita.
 */
function alElegirTratamiento(valor: string): void {
  form.tratamientoId = valor
  const t = tratamientos.value.find((x) => x.id === valor)
  if (t) form.horaFin = sumarMinutos(form.horaInicio, t.duracionMin)
}

/** Si se mueve la hora de inicio, se conserva la duración actual. */
function alCambiarInicio(): void {
  const [h1, m1] = form.horaInicio.split(':').map(Number)
  const [h2, m2] = form.horaFin.split(':').map(Number)
  const duracion = h2 * 60 + m2 - (h1 * 60 + m1)
  form.horaFin = sumarMinutos(form.horaInicio, duracion > 0 ? duracion : 30)
}

async function guardar(): Promise<void> {
  error.value = ''
  if (!form.pacienteId) {
    error.value = 'Elige un paciente'
    return
  }
  if (!form.fecha || !form.horaInicio || !form.horaFin) {
    error.value = 'Fecha y horas son obligatorias'
    return
  }
  guardando.value = true
  try {
    const cita = await crearCita({
      pacienteId: form.pacienteId,
      tratamientoId: form.tratamientoId || null,
      sedeId: form.sedeId || null,
      dentistaId: form.dentistaId || null,
      fecha: deInputFecha(form.fecha) as string,
      horaInicio: form.horaInicio,
      horaFin: form.horaFin,
      observacion: form.observacion.trim() || null,
    })
    emit('creada', cita)
  } catch (e) {
    // Aquí llegan los mensajes de negocio del backend: solapamiento, horario de
    // atención, descanso del consultorio, paciente o dentista inexistente.
    error.value = mensajeDeError(e, 'No se pudo agendar la cita')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalBase titulo="Nueva cita" ancho="lg" @cerrar="emit('cerrar')">
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />
    <p v-if="cargando" class="py-6 text-center text-sm text-muted">Cargando catálogos…</p>

    <form v-else class="grid gap-3 sm:grid-cols-2" @submit.prevent="guardar">
      <div class="sm:col-span-2">
        <label class="mb-1 block text-xs font-medium text-ink">Paciente</label>
        <SelectorEntidad
          v-model:modelo="form.pacienteId"
          :opciones="opcionesPacientes"
          placeholder="Buscar por nombre o documento…"
          vacio="— Sin paciente —"
        />
      </div>

      <div class="sm:col-span-2">
        <label class="mb-1 block text-xs font-medium text-ink">Tratamiento</label>
        <SelectorEntidad
          :modelo="form.tratamientoId"
          :opciones="opcionesTratamientos"
          placeholder="Buscar tratamiento…"
          vacio="— Sin tratamiento —"
          @update:modelo="alElegirTratamiento"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="cita-fecha">Fecha</label>
        <input
          id="cita-fecha"
          v-model="form.fecha"
          type="date"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="cita-inicio">Inicio</label>
          <input
            id="cita-inicio"
            v-model="form.horaInicio"
            type="time"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            @change="alCambiarInicio"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="cita-fin">Fin</label>
          <input
            id="cita-fin"
            v-model="form.horaFin"
            type="time"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink">Sede</label>
        <SelectorEntidad
          v-model:modelo="form.sedeId"
          :opciones="opcionesSedes"
          vacio="— Sin sede —"
        />
      </div>

      <div v-if="puedeVerEquipo">
        <label class="mb-1 block text-xs font-medium text-ink">Odontólogo</label>
        <SelectorEntidad
          v-model:modelo="form.dentistaId"
          :opciones="opcionesDentistas"
          placeholder="Buscar en el equipo…"
          vacio="— Sin asignar —"
        />
      </div>

      <div class="sm:col-span-2">
        <label class="mb-1 block text-xs font-medium text-ink" for="cita-obs">Observación</label>
        <textarea
          id="cita-obs"
          v-model="form.observacion"
          rows="2"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
    </form>

    <template #pie>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
          :disabled="guardando"
          @click="emit('cerrar')"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
          :disabled="guardando || cargando"
          @click="guardar"
        >
          {{ guardando ? 'Agendando…' : 'Agendar' }}
        </button>
      </div>
    </template>
  </ModalBase>
</template>
