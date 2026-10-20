<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AvisoError from '../ui/AvisoError.vue'
import CargandoBloque from '../ui/CargandoBloque.vue'
import { mensajeDeError } from '../../services/errores'
import {
  actualizarPlantilla,
  listarPlantillas,
  restaurarPlantilla,
  vistaPrevia,
  type PlantillaVista,
} from '../../services/plantillas'
import { useSessionStore } from '../../stores/session'

/**
 * Sección «Notificaciones» de Configuración: textos de WhatsApp MANUAL.
 *
 * Sin API de Meta, sin colas y sin envío desde el servidor: aquí solo se
 * editan los textos que luego componen los enlaces `wa.me` de la Agenda.
 * Leer exige `appointments.read`; editar, `appointments.write` (el backend lo
 * exige igualmente).
 */
const sesion = useSessionStore()

const plantillas = ref<PlantillaVista[]>([])
const descripcionMarcadores = ref<Record<string, string>>({})
const cargando = ref(true)
const error = ref('')
const ocupado = ref('')
const textos = reactive<Record<string, string>>({})

const puedeVer = computed(() => sesion.puede('appointments.read'))
const puedeGestionar = computed(() => sesion.puede('appointments.write'))

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const r = await listarPlantillas()
    plantillas.value = r.plantillas
    descripcionMarcadores.value = r.marcadores
    for (const p of r.plantillas) textos[p.clave] = p.texto
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar las plantillas')
  } finally {
    cargando.value = false
  }
}

// El `v-if` del template no evita que `onMounted` dispare el GET: sin permiso
// de lectura de agenda el 403 sería ruido en cada visita a Configuración.
onMounted(() => {
  if (puedeVer.value) void cargar()
})

function cambiado(p: PlantillaVista): boolean {
  return (textos[p.clave] ?? '') !== p.texto
}

/** Muestra `{{marcador}}` como texto (en la plantilla rompería la interpolación). */
function muestraMarcador(marcador: string): string {
  return `{{${marcador}}}`
}

async function guardar(p: PlantillaVista): Promise<void> {
  ocupado.value = p.clave
  error.value = ''
  try {
    const actualizada = await actualizarPlantilla(p.clave, { texto: textos[p.clave] ?? '' })
    plantillas.value = plantillas.value.map((x) => (x.clave === p.clave ? actualizada : x))
    textos[p.clave] = actualizada.texto
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo guardar la plantilla')
  } finally {
    ocupado.value = ''
  }
}

async function alternarActivo(p: PlantillaVista): Promise<void> {
  ocupado.value = p.clave
  error.value = ''
  try {
    const actualizada = await actualizarPlantilla(p.clave, { activo: !p.activo })
    plantillas.value = plantillas.value.map((x) => (x.clave === p.clave ? actualizada : x))
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cambiar el estado')
  } finally {
    ocupado.value = ''
  }
}

async function restaurar(p: PlantillaVista): Promise<void> {
  ocupado.value = p.clave
  error.value = ''
  try {
    const actualizada = await restaurarPlantilla(p.clave)
    plantillas.value = plantillas.value.map((x) => (x.clave === p.clave ? actualizada : x))
    textos[p.clave] = actualizada.texto
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo restaurar la plantilla')
  } finally {
    ocupado.value = ''
  }
}
</script>

<template>
  <section
    v-if="puedeVer"
    id="notificaciones"
    class="scroll-mt-20 rounded-[28px] border border-line bg-background p-5 shadow-sm"
  >
    <h3 class="text-sm font-medium text-ink">Notificaciones por WhatsApp (manual)</h3>
    <p class="mt-1 text-xs text-muted">
      Estos textos componen los enlaces de WhatsApp de cada cita. Nada se envía
      solo: al pulsar la acción se abre el chat con el mensaje listo para enviar.
      Sin API de Meta, sin colas y sin envío desde el servidor.
    </p>

    <CargandoBloque v-if="cargando" texto="Cargando plantillas…" />
    <template v-else>
      <AvisoError v-if="error" class="mt-3" :mensaje="error" />

      <div class="mt-3 rounded-lg bg-background-soft/60 p-3 text-xs text-muted">
        <p class="font-medium text-ink">Marcadores permitidos</p>
        <ul class="mt-1 grid gap-1 sm:grid-cols-2">
          <li v-for="(descripcion, marcador) in descripcionMarcadores" :key="marcador">
            <code class="rounded bg-background px-1 font-mono text-[11px] text-ink">{{ muestraMarcador(String(marcador)) }}</code>
            — {{ descripcion }}
          </li>
        </ul>
      </div>

      <ul class="mt-3 space-y-3">
        <li v-for="p in plantillas" :key="p.clave" class="rounded-lg border border-line p-3">
          <p class="flex flex-wrap items-center gap-2 text-sm">
            <span class="font-medium text-ink">{{ p.nombre }}</span>
            <span
              class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
              :class="p.activo ? 'bg-success/15 text-success' : 'bg-error/15 text-error'"
            >
              {{ p.activo ? 'Activa' : 'Desactivada' }}
            </span>
            <span
              v-if="p.esDefecto"
              class="rounded bg-background-soft px-1.5 py-0.5 text-[10px] uppercase text-muted"
            >
              Texto por defecto
            </span>
          </p>

          <label class="mt-2 block text-xs font-medium text-ink" :for="`plantilla-${p.clave}`">
            Texto del mensaje
          </label>
          <textarea
            :id="`plantilla-${p.clave}`"
            v-model="textos[p.clave]"
            rows="3"
            :disabled="!puedeGestionar"
            class="mt-1 w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
          />

          <p class="mt-2 rounded-md bg-background-soft/60 px-2.5 py-1.5 text-xs text-ink">
            <span class="font-medium text-muted">Vista previa: </span>{{ vistaPrevia(textos[p.clave] ?? '') }}
          </p>

          <div v-if="puedeGestionar" class="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft disabled:opacity-60"
              :disabled="ocupado === p.clave || !cambiado(p)"
              @click="guardar(p)"
            >
              {{ ocupado === p.clave ? 'Guardando…' : 'Guardar texto' }}
            </button>
            <button
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft disabled:opacity-60"
              :disabled="ocupado === p.clave"
              @click="alternarActivo(p)"
            >
              {{ p.activo ? 'Desactivar' : 'Activar' }}
            </button>
            <button
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft disabled:opacity-60"
              :disabled="ocupado === p.clave || p.esDefecto"
              title="Vuelve al texto por defecto del sistema"
              @click="restaurar(p)"
            >
              Restaurar texto por defecto
            </button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>
