<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import ModalBase from '../../components/ui/ModalBase.vue'
import ModalConfirmar from '../../components/ui/ModalConfirmar.vue'
import { mensajeDeError } from '../../services/errores'
import { formatearFechaUTC } from '../../services/fechas'
import {
  archivarClinica,
  eliminarClinica,
  listarClinicas,
  reactivarClinica,
  restaurarClinica,
  suspenderClinica,
  type ClinicaResumen,
} from '../../services/plataforma'

const router = useRouter()
const clinicas = ref<ClinicaResumen[]>([])
const cargando = ref(true)
const error = ref('')
const procesando = ref(false)
const busqueda = ref('')

/** Acción circulando: archivar (modal) o eliminar (modal con slug). */
const archivarAccion = ref<ClinicaResumen | null>(null)
const eliminarAccion = ref<ClinicaResumen | null>(null)
const slugEscrito = ref('')
const slugValido = computed(
  () => !!eliminarAccion.value && slugEscrito.value === eliminarAccion.value.slug,
)

const filtradas = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return clinicas.value
  return clinicas.value.filter(
    (c) => c.nombre.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q),
  )
})

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    clinicas.value = await listarClinicas()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar las clínicas')
  } finally {
    cargando.value = false
  }
}

/** Archivada = borrado lógico (dato conservado, sin acceso). */
function archivada(c: ClinicaResumen): boolean {
  return !!c.deletedAt
}

/** Suspendida por la plataforma (suscripción o estado del tenant). */
function suspendida(c: ClinicaResumen): boolean {
  return c.estado === 'SUSPENDED' || c.suscripcion?.estado === 'SUSPENDED'
}

function filaClase(estado: string): string {
  if (estado === 'ACTIVE') return 'bg-primary/10 text-primary'
  if (estado === 'SUSPENDED') return 'bg-error/10 text-error'
  return 'bg-warning/10 text-warning'
}

async function ejectuar(paso: () => Promise<unknown>, porDefecto: string): Promise<boolean> {
  procesando.value = true
  try {
    await paso()
    await cargar()
    return true
  } catch (e) {
    error.value = mensajeDeError(e, porDefecto)
    return false
  } finally {
    procesando.value = false
  }
}

async function confirmarCambio(c: ClinicaResumen): Promise<void> {
  const fueSuspendida = suspendida(c)
  await ejectuar(
    () => (fueSuspendida ? reactivarClinica(c.id) : suspenderClinica(c.id)),
    fueSuspendida ? 'No se pudo reactivar la clínica' : 'No se pudo suspender la clínica',
  )
}

async function confirmarArchivar(): Promise<void> {
  if (!archivarAccion.value) return
  const ok = await ejectuar(
    () => archivarClinica(archivarAccion.value!.id),
    'No se pudo archivar la clínica',
  )
  if (ok) archivarAccion.value = null
}

async function confirmarRestaurar(c: ClinicaResumen): Promise<void> {
  await ejectuar(() => restaurarClinica(c.id), 'No se pudo restaurar la clínica')
}

async function confirmarEliminar(): Promise<void> {
  if (!eliminarAccion.value || !slugValido.value) return
  const ok = await ejectuar(
    () => eliminarClinica(eliminarAccion.value!.id),
    'No se pudo eliminar la clínica',
  )
  if (ok) {
    eliminarAccion.value = null
    slugEscrito.value = ''
  }
}

onMounted(cargar)
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <h1 class="text-lg font-semibold text-ink">Clínicas</h1>
      <input
        v-model="busqueda"
        type="search"
        placeholder="Buscar por nombre o slug…"
        class="ml-auto w-full max-w-xs rounded-md border border-line bg-background px-3 py-1.5 text-sm text-ink placeholder:text-muted focus:border-primary focus:outline-none sm:w-auto"
        aria-label="Buscar clínica por nombre o slug"
      />
      <button
        class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark"
        @click="router.push({ name: 'admin-clinica-alta' })"
      >
        Alta de clínica
      </button>
    </div>

    <AvisoError v-if="!cargando && error" :mensaje="error" />

    <CargandoBloque v-if="cargando" texto="Cargando clínicas…" />
    <EstadoVacio
      v-else-if="clinicas.length === 0"
      titulo="Sin clínicas"
      detalle="Da de alta la primera con el botón superior."
    />
    <EstadoVacio
      v-else-if="filtradas.length === 0"
      titulo="Sin resultados"
      :detalle="`Ninguna clínica coincide con «${busqueda}».`"
    />
    <div
      v-else
      class="overflow-hidden rounded-[28px] border border-line bg-background shadow-sm"
    >
      <div class="overflow-x-auto">
        <table class="w-full min-w-[820px] text-sm">
          <thead class="bg-background-soft/70 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th class="px-4 py-2 font-medium">Clínica</th>
              <th class="px-4 py-2 font-medium">Plan</th>
              <th class="px-4 py-2 font-medium">Estado</th>
              <th class="px-4 py-2 font-medium">Periodo</th>
              <th class="px-4 py-2 font-medium">Usuarios</th>
              <th class="px-4 py-2 font-medium">Pacientes</th>
              <th class="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in filtradas"
              :key="c.id"
              class="border-t border-line/70 transition first:border-0 hover:bg-background-soft/60"
            >
              <td class="px-4 py-2">
                <button
                  type="button"
                  class="text-left font-semibold text-ink hover:text-primary"
                  @click="router.push({ name: 'admin-clinica-detalle', params: { id: c.id } })"
                >
                  {{ c.nombre }}
                </button>
                <p class="text-xs text-muted">{{ c.slug }}</p>
              </td>
              <td class="px-4 py-2 text-muted">{{ c.suscripcion?.plan?.nombre ?? 'Sin plan' }}</td>
              <td class="px-4 py-2">
                <span
                  class="rounded-full px-2.5 py-0.5 text-xs font-medium"
                  :class="archivada(c) ? 'bg-muted/15 text-muted' : filaClase(c.estado)"
                >
                  {{ archivada(c) ? 'ARCHIVADA' : c.estado }}
                </span>
              </td>
              <td class="px-4 py-2 text-muted">
                <template v-if="c.suscripcion">
                  {{ formatearFechaUTC(c.suscripcion.periodoInicio) }} –
                  {{ formatearFechaUTC(c.suscripcion.periodoFin) }}
                </template>
                <span v-else>—</span>
              </td>
              <td class="px-4 py-2 text-muted">{{ c.usuarios }}</td>
              <td class="px-4 py-2 text-muted">{{ c.pacientes }}</td>
              <td class="whitespace-nowrap px-4 py-2 text-right">
                <div class="inline-flex flex-wrap justify-end gap-1.5">
                  <button
                    type="button"
                    class="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink"
                    @click="router.push({ name: 'admin-clinica-detalle', params: { id: c.id } })"
                  >
                    Ver
                  </button>
                  <template v-if="!archivada(c)">
                    <button
                      type="button"
                      class="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink"
                      @click="confirmarCambio(c)"
                    >
                      {{ suspendida(c) ? 'Reactivar' : 'Suspender' }}
                    </button>
                    <button
                      type="button"
                      class="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink"
                      @click="archivarAccion = c"
                    >
                      Archivar
                    </button>
                  </template>
                  <button
                    v-else
                    type="button"
                    class="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink"
                    @click="confirmarRestaurar(c)"
                  >
                    Restaurar
                  </button>
                  <button
                    type="button"
                    class="rounded-md border border-error/40 px-2 py-1 text-xs text-error hover:bg-error/10"
                    @click="
                      eliminarAccion = c;
                      slugEscrito = '';
                    "
                  >
                    Eliminar
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <ModalConfirmar
      v-if="archivarAccion"
      titulo="Archivar clínica"
      :mensaje="`Se archivará ${archivarAccion.nombre}: dejará de aparecer en el listado y sus usuarios no podrán iniciar sesión. Los datos se conservan y se pueden restaurar en cualquier momento.`"
      texto-confirmar="Archivar"
      peligro
      :ocupado="procesando"
      @confirmar="confirmarArchivar"
      @cancelar="archivarAccion = null"
    />

    <ModalBase
      v-if="eliminarAccion"
      titulo="Eliminar clínica"
      ancho="sm"
      @cerrar="eliminarAccion = null"
    >
      <p class="text-sm text-muted">
        Esta acción es <strong class="text-error">irreversible</strong>: se borrarán
        la clínica, sus roles, configuración y usuarios que no pertenezcan a otra clínica.
      </p>
      <p class="mt-2 text-sm text-muted">
        Para confirmar, escribe el slug exacto
        <strong class="text-ink">{{ eliminarAccion.slug }}</strong>:
      </p>
      <input
        v-model="slugEscrito"
        type="text"
        :placeholder="eliminarAccion.slug"
        aria-label="Escribe el slug para confirmar"
        class="mt-2 w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-ink focus:border-error focus:outline-none"
      />
      <template #pie>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
            :disabled="procesando"
            @click="eliminarAccion = null"
          >
            Cancelar
          </button>
          <button
            type="button"
            class="rounded-md bg-error px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            :disabled="!slugValido || procesando"
            @click="confirmarEliminar"
          >
            {{ procesando ? 'Procesando…' : 'Eliminar definitivamente' }}
          </button>
        </div>
      </template>
    </ModalBase>
  </div>
</template>
