<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { actualizarCita, obtenerDisponibilidad, type Cita, type HuecoDisponibilidad } from '../../services/citas'
import { mensajeDeError } from '../../services/errores'
import { formatearFechaUTC, hora12, hoyLima, paraInputFecha, sumarMinutos } from '../../services/fechas'
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
/** La rejilla no se pudo cargar (red/permiso), distinto de un día sin huecos. */
const sinRejilla = ref(false)
let solicitudHuecos = 0

/** Fecha civil original de la cita (la que se está moviendo). */
const fechaOriginal = computed(() => paraInputFecha(props.cita.fecha))
/**
 * ¿Esa hora es la original de la cita en su fecha original? Su hueco lo ocupa
 * la propia cita, no otra, así que debe seguir siendo elegible aunque el
 * usuario haya probado otra hora y quiera volver.
 */
function esHoraDeLaCita(hora: string): boolean {
  return fecha.value === fechaOriginal.value && hora === props.cita.horaInicio
}

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
  const actual = ++solicitudHuecos
  cargando.value = true
  try {
    const lista = await obtenerDisponibilidad(
      fecha.value,
      duracion.value,
      props.cita.sedeId,
      props.cita.dentistaId,
    )
    // Cambiar de fecha rápido no debe dejar la rejilla de la fecha anterior.
    if (actual === solicitudHuecos) {
      huecos.value = lista
      sinRejilla.value = false
    }
  } catch {
    if (actual === solicitudHuecos) {
      huecos.value = []
      sinRejilla.value = true
    }
  } finally {
    if (actual === solicitudHuecos) cargando.value = false
  }
}

/**
 * Opciones del selector. La hora original NUNCA se cambia sola: si la rejilla
 * la marca ocupada suele ser por la propia cita (el backend excluye la cita al
 * guardar), así que se ofrece como opción válida y se deja decidir al usuario.
 */
const opcionesInicio = computed(() => {
  const lista = huecos.value.map((h) => ({
    valor: h.horaInicio,
    etiqueta: h.disponible ? hora12(h.horaInicio) : `${hora12(h.horaInicio)} — ${h.motivo}`,
    deshabilitado: !h.disponible && !esHoraDeLaCita(h.horaInicio),
  }))
  if (horaInicio.value && !lista.some((o) => o.valor === horaInicio.value)) {
    lista.unshift({
      valor: horaInicio.value,
      etiqueta: `${hora12(horaInicio.value)} (la de la cita)`,
      deshabilitado: false,
    })
  }
  return lista
})

/** Motivo por el que la hora elegida no está libre (sin contar la propia cita). */
const motivoHora = computed(() => {
  if (esHoraDeLaCita(horaInicio.value)) return ''
  const h = huecos.value.find((x) => x.horaInicio === horaInicio.value)
  return h && !h.disponible ? `Esa hora no está libre: ${h.motivo}.` : ''
})

onMounted(() => {
  fecha.value = paraInputFecha(props.cita.fecha) || hoyLima()
  horaInicio.value = props.cita.horaInicio
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
  // se navega a WhatsApp cuando el guardado responde. Sin aviso no se abre.
  const ventana = puedeAvisar.value ? window.open('about:blank', '_blank') : null
  // Se conserva el handle (hace falta para navegar dentro del gesto del clic)
  // pero se corta la relación con la página que abre.
  if (ventana) ventana.opener = null
  guardando.value = true
  try {
    const actualizada = await actualizarCita(props.cita.id, {
      fecha: fecha.value,
      horaInicio: horaInicio.value,
      horaFin: horaFin.value,
      estado: 'reprogramada',
    })
    if (puedeAvisar.value) {
      const url = enlaceWhatsapp(
        props.telefono as string,
        mensajeNuevo(actualizada.fecha, actualizada.horaInicio),
      )
      if (ventana) ventana.location.href = url
      else window.open(url, '_blank')
    }
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
        <FechaInput id="repro-fecha" v-model="fecha" :min="hoyLima()" />
      </div>
      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="repro-inicio">Nueva hora</label>
        <select
          id="repro-inicio"
          v-model="horaInicio"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option v-if="cargando" value="" disabled>Cargando horas…</option>
          <option
            v-for="o in opcionesInicio"
            :key="o.valor"
            :value="o.valor"
            :disabled="o.deshabilitado"
          >
            {{ o.etiqueta }}
          </option>
        </select>
        <p v-if="motivoHora" class="mt-1 text-xs text-warning">{{ motivoHora }}</p>
        <p v-else-if="sinRejilla && !cargando" class="mt-1 text-xs text-muted">
          No se pudo cargar la disponibilidad; el servidor validará el cambio al guardar.
        </p>
        <p v-else-if="!cargando && huecos.length === 0" class="mt-1 text-xs text-warning">
          No hay horarios disponibles para esa fecha; elige otro día.
        </p>
        <p v-if="horaInicio" class="mt-1 text-xs text-muted">
          Termina a las {{ hora12(horaFin) }} (misma duración).
        </p>
      </div>
    </div>

    <p v-if="plantilla && telefono" class="mt-3 rounded-md bg-background-soft/60 px-2.5 py-1.5 text-xs text-ink">
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
