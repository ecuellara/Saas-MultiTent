<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AvisoError from '../ui/AvisoError.vue'
import CargandoBloque from '../ui/CargandoBloque.vue'
import { listarMiembros, listarSedes, type Miembro, type Sede } from '../../services/catalogos'
import { mensajeDeError } from '../../services/errores'
import {
  actualizarFeed,
  crearFeed,
  eliminarFeed,
  listarFeeds,
  regenerarFeed,
  urlSuscripcionFeed,
  type FeedCalendario,
} from '../../services/feeds-calendario'
import { useSessionStore } from '../../stores/session'

/**
 * Sección «Calendario» de Configuración: feeds ICS suscribibles (sin OAuth).
 *
 * Un feed es una URL secreta que expone la agenda como calendario para
 * suscribirla desde el celular. Crear y revocar exigen `appointments.write`;
 * ver la lista, `appointments.read` (el backend lo exige igualmente).
 */
const sesion = useSessionStore()

const feeds = ref<FeedCalendario[]>([])
const sedes = ref<Sede[]>([])
const miembros = ref<Miembro[]>([])
const cargando = ref(true)
const error = ref('')
const ocupado = ref('')
const copiado = ref('')
const confirmarAccion = ref('')

const form = reactive({ sedeId: '', dentistaId: '' })

const puedeVer = computed(() => sesion.puede('appointments.read'))
const puedeGestionar = computed(() => sesion.puede('appointments.write'))

const nombreSede = computed(() => new Map(sedes.value.map((s) => [s.id, s.nombre])))
const nombreDentista = computed(
  () => new Map(miembros.value.map((m) => [m.id, `${m.user.nombre} · ${m.role.codigo}`])),
)

function alcance(feed: FeedCalendario): string {
  const sede = feed.sedeId ? (nombreSede.value.get(feed.sedeId) ?? 'Sede') : 'Toda la clínica'
  const dentista = feed.dentistaId
    ? (nombreDentista.value.get(feed.dentistaId) ?? 'Odontólogo')
    : 'Todas las agendas'
  return `${sede} · ${dentista}`
}

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const [f, s] = await Promise.all([listarFeeds(), listarSedes()])
    feeds.value = f
    sedes.value = s
    // El equipo exige `members.manage`: sin permiso el selector de odontólogo
    // ofrece solo «todas las agendas» (igual que en la agenda).
    miembros.value = await listarMiembros().catch(() => [])
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar los feeds de calendario')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

async function crear(): Promise<void> {
  ocupado.value = 'nuevo'
  error.value = ''
  try {
    const feed = await crearFeed({
      sedeId: form.sedeId || null,
      dentistaId: form.dentistaId || null,
    })
    feeds.value = [feed, ...feeds.value]
    form.sedeId = ''
    form.dentistaId = ''
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo crear el feed')
  } finally {
    ocupado.value = ''
  }
}

async function copiar(feed: FeedCalendario): Promise<void> {
  error.value = ''
  const url = urlSuscripcionFeed(feed.token)
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    // Portapapeles no disponible (HTTP sin localhost, permiso denegado):
    // se selecciona para copiar a mano.
    const campo = document.getElementById(`url-feed-${feed.id}`) as HTMLInputElement | null
    campo?.select()
    return
  }
  copiado.value = feed.id
  window.setTimeout(() => {
    if (copiado.value === feed.id) copiado.value = ''
  }, 2500)
}

async function alternarActivo(feed: FeedCalendario): Promise<void> {
  ocupado.value = feed.id
  error.value = ''
  try {
    const actualizado = await actualizarFeed(feed.id, !feed.activo)
    feeds.value = feeds.value.map((f) => (f.id === feed.id ? actualizado : f))
    confirmarAccion.value = ''
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cambiar el estado del feed')
  } finally {
    ocupado.value = ''
  }
}

async function regenerar(feed: FeedCalendario): Promise<void> {
  if (confirmarAccion.value !== `regenerar-${feed.id}`) {
    confirmarAccion.value = `regenerar-${feed.id}`
    return
  }
  ocupado.value = feed.id
  error.value = ''
  try {
    const actualizado = await regenerarFeed(feed.id)
    feeds.value = feeds.value.map((f) => (f.id === feed.id ? actualizado : f))
    confirmarAccion.value = ''
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo regenerar el feed')
  } finally {
    ocupado.value = ''
  }
}

async function eliminar(feed: FeedCalendario): Promise<void> {
  if (confirmarAccion.value !== `eliminar-${feed.id}`) {
    confirmarAccion.value = `eliminar-${feed.id}`
    return
  }
  ocupado.value = feed.id
  error.value = ''
  try {
    await eliminarFeed(feed.id)
    feeds.value = feeds.value.filter((f) => f.id !== feed.id)
    confirmarAccion.value = ''
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo eliminar el feed')
  } finally {
    ocupado.value = ''
  }
}
</script>

<template>
  <section
    v-if="puedeVer"
    id="calendario"
    class="scroll-mt-20 rounded-[28px] border border-line bg-background p-5 shadow-sm"
  >
    <h3 class="text-sm font-medium text-ink">Calendario del celular (sin cuenta de Google)</h3>
    <p class="mt-1 text-xs text-muted">
      Crea una dirección secreta de tu agenda y suscríbela en la app de calendario del
      celular. Sin OAuth, sin proyecto en Google Cloud y sin verificación: el calendario
      la consulta solo cada pocas horas.
    </p>

    <p class="mt-3 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning" role="note">
      Aviso de privacidad: el feed muestra el <strong>nombre del paciente</strong> en el
      título de cada cita. Quien tenga esa URL verá tu agenda (nombres, tratamientos y
      horarios). El token es revocable en un clic: desactiva o regenera el feed y la URL
      vieja deja de funcionar.
    </p>

    <CargandoBloque v-if="cargando" texto="Cargando feeds…" />
    <template v-else>
      <AvisoError v-if="error" class="mt-3" :mensaje="error" />

      <div v-if="puedeGestionar" class="mt-3 flex flex-wrap items-end gap-2">
        <label class="block text-sm">
          <span class="mb-1 block font-medium text-ink">Sede</span>
          <select
            v-model="form.sedeId"
            class="rounded-md border border-line bg-background-soft px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Toda la clínica</option>
            <option v-for="s in sedes" :key="s.id" :value="s.id">{{ s.nombre }}</option>
          </select>
        </label>
        <label class="block text-sm">
          <span class="mb-1 block font-medium text-ink">Odontólogo</span>
          <select
            v-model="form.dentistaId"
            class="rounded-md border border-line bg-background-soft px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Todas las agendas</option>
            <option v-for="m in miembros" :key="m.id" :value="m.id">
              {{ m.user.nombre }} · {{ m.role.codigo }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
          :disabled="ocupado === 'nuevo'"
          @click="crear"
        >
          {{ ocupado === 'nuevo' ? 'Creando…' : 'Crear feed' }}
        </button>
      </div>
      <p v-else class="mt-3 text-xs text-muted">
        Solo lectura: tu rol no tiene permiso para crear o revocar feeds.
      </p>

      <ul v-if="feeds.length > 0" class="mt-3 space-y-2">
        <li
          v-for="feed in feeds"
          :key="feed.id"
          class="rounded-lg border border-line p-3"
          :class="!feed.activo && 'opacity-60'"
        >
          <p class="flex flex-wrap items-center gap-2 text-sm">
            <span class="font-medium text-ink">{{ alcance(feed) }}</span>
            <span
              class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
              :class="feed.activo ? 'bg-success/15 text-success' : 'bg-error/15 text-error'"
            >
              {{ feed.activo ? 'Activo' : 'Desactivado' }}
            </span>
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <input
              :id="`url-feed-${feed.id}`"
              type="text"
              readonly
              :value="urlSuscripcionFeed(feed.token)"
              class="min-w-0 flex-1 rounded-md border border-line bg-background-soft px-2 py-1.5 font-mono text-xs text-muted focus:outline-none focus:ring-2 focus:ring-primary"
              @focus="($event.target as HTMLInputElement).select()"
            />
            <button
              type="button"
              class="rounded-md border border-line px-3 py-1.5 text-xs text-ink hover:bg-background-soft"
              @click="copiar(feed)"
            >
              {{ copiado === feed.id ? '¡Copiada!' : 'Copiar' }}
            </button>
          </div>
          <div v-if="puedeGestionar" class="mt-2 flex flex-wrap gap-1">
            <button
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft disabled:opacity-60"
              :disabled="ocupado === feed.id"
              @click="alternarActivo(feed)"
            >
              {{ feed.activo ? 'Desactivar' : 'Reactivar' }}
            </button>
            <button
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft disabled:opacity-60"
              :disabled="ocupado === feed.id"
              @click="regenerar(feed)"
            >
              {{
                confirmarAccion === `regenerar-${feed.id}`
                  ? 'Confirma: la URL vieja morirá'
                  : 'Regenerar token'
              }}
            </button>
            <button
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-60"
              :disabled="ocupado === feed.id"
              @click="eliminar(feed)"
            >
              {{ confirmarAccion === `eliminar-${feed.id}` ? 'Confirma eliminar' : 'Eliminar' }}
            </button>
          </div>
        </li>
      </ul>
      <p v-else class="mt-2 text-xs text-muted">Sin feeds. Crea el primero para tu agenda.</p>

      <div class="mt-4 rounded-lg bg-background-soft/60 p-3 text-xs text-muted">
        <p class="font-medium text-ink">Cómo suscribirse en el celular</p>
        <ul class="mt-1 list-disc space-y-1 pl-5">
          <li>
            <strong>Google Calendar:</strong> «Otros calendarios → Suscribirse desde URL»:
            pega la URL copiada y pulsa «Añadir calendario». Aparece en tu cuenta y en el
            celular en unas horas.
          </li>
          <li>
            <strong>Apple (iPhone):</strong> «Añadir calendario → Añadir suscripción de
            calendario»: pega la URL y pulsa «Suscribirse».
          </li>
        </ul>
        <p class="mt-2">
          Si cambias o reprogramas una cita, el evento se actualiza solo (no se duplica).
          Para dejar de compartir, desactiva o elimina el feed.
        </p>
      </div>
    </template>
  </section>
</template>
