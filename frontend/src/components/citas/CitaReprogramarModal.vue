<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { actualizarCita, obtenerDisponibilidad, type Cita, type HuecoDisponibilidad } from '../../services/citas'
import { mensajeDeError } from '../../services/errores'
import { deInputFecha, formatearFechaUTC, hora12, hoyLocal, sumarMinutos } from '../../services/fechas'
import { sustituirMarcadores } from '../../services/plantillas'
import { enlaceWhatsapp } from '../../services/whatsapp'
import AvisoError from '../ui/AvisoError.vue'
import FechaInput from '../ui/FechaInput.vue'
import ModalBase from '../ui/ModalBase.vue'

/**
 * Reprogramar y avisar por WhatsApp (manual, sin API de Meta).
 *
 * Primero se cambia la cita con el endpoint que ya existe (`PATCH /citas/:id`
 * con fecha, horas y estado `reprogramada`) y el mensaje se compone con los
 * datos NUEVOS. El chat se abre en la misma ventana gestual del clic (truco de
 * la pestaña en blanco) para que el bloqueador de ventanas no lo cierre.
 */
const props = defineProps<{
  cita: Cita
  paciente: string
  /** Teléfono YA normalizado; `null` = sin teléfono o mal formado. */
  telefono: string | null
  /** Texto de la plantilla `cita_reprogramacion`; `null` = inactiva. */
  plantilla: string | null
  clinica: string
  odontologo: string
  sede: string
}>()

const emit = defineEmits<{ avisada: [Cita]; cerrar: [] }>()

const fecha = ref('')
const horaInicio = ref('')
const huecos = ref<HuecoDisponibilidad[]>([])
const cargando = ref(true)
const guardando = ref(false)
const error = ref('')

/** Duración original de la cita (el fin se conserva). */
const duracion = computed(() => {
  const [h1, m1] = props.cita.horaInicio.split(':').map(Number)
  const [h2, m2] = props.cita.horaFin.split(':').map(Number)
  const d = h2 * 60 + m2 - (h1 * 60 + m1)
  return d > 0 ? d : 30
})
const horaFin = computed(() => sumarMinutos(horaInicio.value, duracion.value))

const puedeAvisar = computed(() => props.telefono !== null && props.plantilla !== null)

async function cargarHuecos(): Promise<void> {
  if (!fecha.value) return
  cargando.value = true
  try {
    huecos.value = await obtenerDisponibilidad(
      fecha.value,
      duracion.value,
      props.cita.sedeId,
      props.cita.dentistaId,
    )
    if (!huecos.value.some((h) => h.horaInicio === horaInicio.value && h.disponible)) {
      horaInicio.value = huecos.value.find((h) => h.disponible)?.horaInicio ?? ''
    }
  } catch {
    huecos.value = []
  } finally {
    cargando.value = false
  }
}

onMounted(() => {
  const d = new Date(props.cita.fecha)
  fecha.value = Number.isNaN(d.getTime()) ? hoyLocal() : d.toISOString().slice(0, 10)
  horaInicio.value = props.cita.horaInicio
  void cargarHuecos()
})
watch(fecha, () => void cargarHuecos())

function mensajeNuevo(fechaIso: string, inicio: string): string {
  return sustituirMarcadores(props.plantilla ?? '', {
    paciente: props.paciente,
    fecha: formatearFechaUTC(fechaIso),
    hora: inicio,
    clinica: props.clinica,
    odontologo: props.odontologo,
    sede: props.sede,
  })
}

async function guardar(): Promise<void> {
  error.value = ''
  if (!fecha.value || !horaInicio.value) {
    error.value = 'Elige fecha y hora para la reprogramación'
    return
  }
  // La pestaña se abre en el gesto del clic: el bloqueador la permite y luego
  // se navega a WhatsApp cuando el guardado responde.
  const ventana = window.open('about:blank', '_blank')
  guardando.value = true
  try {
    const actualizada = await actualizarCita(props.cita.id, {
      fecha: deInputFecha(fecha.value) as string,
      horaInicio: horaInicio.value,
      horaFin: horaFin.value,
      estado: 'reprogramada',
    })
    const url = enlaceWhatsapp(props.telefono as string, mensajeNuevo(actualizada.fecha, actualizada.horaInicio))
    if (ventana) ventana.location.href = url
    else window.open(url, '_blank')
    emit('avisada', actualizada)
  } catch (e) {
    ventana?.close()
    error.value = mensajeDeError(e, 'No se pudo reprogramar la cita')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalBase titulo="Reprogramar y avisar" @cerrar="emit('cerrar')">
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />
    <p v-if="!puedeAvisar" class="mb-4 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
      <span v-if="!telefono">Sin teléfono válido del paciente: no se puede avisar por WhatsApp.</span>
      <span v-else>La plantilla de reprogramación está desactivada (Configuración → Notificaciones).</span>
    </p>

    <div class="grid gap-3 sm:grid-cols-2">
      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="repro-fecha">Nueva fecha</label>
        <FechaInput id="repro-fecha" v-model="fecha" :min="hoyLocal()" />
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="repro-inicio">Nueva hora</label>
        <select
          id="repro-inicio"
          v-model="horaInicio"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option v-if="cargando" value="">Cargando horas…</option>
          <option
            v-for="h in huecos"
            :key="h.horaInicio"
            :value="h.horaInicio"
            :disabled="!h.disponible"
          >
            {{ h.disponible ? hora12(h.horaInicio) : `${hora12(h.horaInicio)} — ${h.motivo}` }}
          </option>
        </select>
        <p class="mt-1 text-xs text-muted">Termina a las {{ hora12(horaFin) }} (misma duración).</p>
      </div>
    </div>

    <p v-if="plantilla" class="mt-3 rounded-md bg-background-soft/60 px-2.5 py-1.5 text-xs text-ink">
      <span class="font-medium text-muted">Se enviará: </span>{{ mensajeNuevo(fecha ? `${fecha}T00:00:00.000Z` : cita.fecha, horaInicio || cita.horaInicio) }}
    </p>

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
          :disabled="guardando || !puedeAvisar || !horaInicio"
          @click="guardar"
        >
          {{ guardando ? 'Guardando…' : 'Reprogramar y avisar' }}
        </button>
      </div>
    </template>
  </ModalBase>
</template>
