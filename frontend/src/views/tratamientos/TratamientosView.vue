<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { PencilIcon, PlusIcon, TagIcon } from '@heroicons/vue/24/outline'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import ModalBase from '../../components/ui/ModalBase.vue'
import ModuloHero from '../../components/ui/ModuloHero.vue'
import { listarTratamientos, precioDe, type Tratamiento } from '../../services/catalogos'
import { mensajeDeError } from '../../services/errores'
import {
  actualizarTratamiento,
  crearEspecialidad,
  crearTratamiento,
  listarEspecialidades,
  type Especialidad,
} from '../../services/tratamientos'
import { useSessionStore } from '../../stores/session'

const sesion = useSessionStore()
const tratamientos = ref<Tratamiento[]>([])
const especialidades = ref<Especialidad[]>([])
const cargando = ref(true)
const guardando = ref(false)
const error = ref('')
const errorForm = ref('')
const busqueda = ref('')
const soloActivos = ref(false)
const modalTratamiento = ref(false)
const modalEspecialidad = ref(false)
const editando = ref<Tratamiento | null>(null)

const form = ref({ nombre: '', descripcion: '', especialidadId: '', precio: '', duracionMin: '30' })
const formEspecialidad = ref({ nombre: '', descripcion: '' })
const puedeEscribir = computed(() => sesion.puede('patients.write'))
const mapaEspecialidades = computed(() => new Map(especialidades.value.map((e) => [e.id, e.nombre])))
const activos = computed(() => tratamientos.value.filter((t) => t.activo).length)
const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  return tratamientos.value.filter((t) => {
    if (soloActivos.value && !t.activo) return false
    const especialidad = t.especialidadId ? mapaEspecialidades.value.get(t.especialidadId) ?? '' : ''
    return !q || `${t.nombre} ${t.descripcion ?? ''} ${especialidad}`.toLowerCase().includes(q)
  })
})

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const [lista, catalogo] = await Promise.all([listarTratamientos(), listarEspecialidades()])
    tratamientos.value = lista
    especialidades.value = catalogo
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar el catálogo de tratamientos')
  } finally {
    cargando.value = false
  }
}
onMounted(cargar)

function abrirNuevo(): void {
  editando.value = null
  form.value = { nombre: '', descripcion: '', especialidadId: '', precio: '', duracionMin: '30' }
  errorForm.value = ''
  modalTratamiento.value = true
}
function abrirEdicion(t: Tratamiento): void {
  editando.value = t
  form.value = {
    nombre: t.nombre,
    descripcion: t.descripcion ?? '',
    especialidadId: t.especialidadId ?? '',
    precio: String(precioDe(t)),
    duracionMin: String(t.duracionMin),
  }
  errorForm.value = ''
  modalTratamiento.value = true
}
async function guardarTratamiento(): Promise<void> {
  errorForm.value = ''
  const nombre = form.value.nombre.trim()
  const precio = Number(form.value.precio)
  const duracionMin = Number(form.value.duracionMin)
  if (!nombre) { errorForm.value = 'El nombre es obligatorio'; return }
  if (!Number.isFinite(precio) || precio < 0) { errorForm.value = 'El precio debe ser cero o mayor'; return }
  if (!Number.isFinite(duracionMin) || duracionMin < 5) { errorForm.value = 'La duración mínima es 5 minutos'; return }
  guardando.value = true
  try {
    const dto = {
      nombre,
      descripcion: form.value.descripcion.trim() || undefined,
      especialidadId: form.value.especialidadId || undefined,
      precio,
      duracionMin,
    }
    if (editando.value) await actualizarTratamiento(editando.value.id, dto)
    else await crearTratamiento(dto)
    modalTratamiento.value = false
    await cargar()
  } catch (e) {
    errorForm.value = mensajeDeError(e, 'No se pudo guardar el tratamiento')
  } finally {
    guardando.value = false
  }
}
async function alternar(t: Tratamiento): Promise<void> {
  error.value = ''
  try {
    await actualizarTratamiento(t.id, { activo: !t.activo })
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cambiar el estado del tratamiento')
  }
}
async function guardarEspecialidad(): Promise<void> {
  errorForm.value = ''
  const nombre = formEspecialidad.value.nombre.trim()
  if (!nombre) { errorForm.value = 'El nombre de la especialidad es obligatorio'; return }
  guardando.value = true
  try {
    const creada = await crearEspecialidad({ nombre, descripcion: formEspecialidad.value.descripcion.trim() || undefined })
    especialidades.value = [...especialidades.value, creada].sort((a, b) => a.nombre.localeCompare(b.nombre))
    form.value.especialidadId = creada.id
    formEspecialidad.value = { nombre: '', descripcion: '' }
    modalEspecialidad.value = false
  } catch (e) {
    errorForm.value = mensajeDeError(e, 'No se pudo crear la especialidad')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <ModuloHero etiqueta="Catálogo clínico" titulo="Tratamientos y tarifas"
      descripcion="Administra los procedimientos, precios, duración y especialidad de la clínica."
      :icono="TagIcon" :metrica="String(activos)" metrica-etiqueta="Activos">
      <button v-if="puedeEscribir" type="button"
        class="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark"
        @click="abrirNuevo"><PlusIcon class="h-5 w-5" />Nuevo tratamiento</button>
    </ModuloHero>

    <div class="flex flex-col gap-3 rounded-[28px] border border-line bg-background p-4 shadow-sm sm:flex-row sm:items-center">
      <input v-model="busqueda" type="search" placeholder="Buscar tratamiento o especialidad…"
        class="min-w-0 flex-1 rounded-2xl border border-line bg-background-soft/60 px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary" />
      <label class="flex items-center gap-2 text-sm text-muted"><input v-model="soloActivos" type="checkbox" class="h-4 w-4 accent-primary" />Solo activos</label>
      <button v-if="puedeEscribir" type="button" class="rounded-full border border-line px-4 py-2.5 text-sm font-semibold text-ink hover:bg-background-soft"
        @click="errorForm = ''; modalEspecialidad = true">Nueva especialidad</button>
    </div>

    <AvisoError v-if="error" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando tratamientos…" />
    <EstadoVacio v-else-if="filtrados.length === 0" titulo="Sin tratamientos"
      :detalle="busqueda || soloActivos ? 'Ningún tratamiento coincide con el filtro.' : 'Crea el primero para utilizarlo en agenda y cobros.'" />

    <div v-else class="overflow-hidden rounded-[28px] border border-line bg-background shadow-sm">
      <div class="overflow-x-auto">
        <table class="w-full min-w-[720px] text-sm">
          <thead><tr class="border-b border-line bg-background-soft/70 text-left text-xs uppercase tracking-wide text-muted">
            <th class="p-4">Tratamiento</th><th class="p-4">Especialidad</th><th class="p-4">Precio</th><th class="p-4">Duración</th><th class="p-4">Estado</th><th class="p-4" />
          </tr></thead>
          <tbody><tr v-for="t in filtrados" :key="t.id" class="border-b border-line/70 last:border-0 hover:bg-background-soft/60" :class="!t.activo && 'opacity-55'">
            <td class="p-4"><p class="font-semibold text-ink">{{ t.nombre }}</p><p class="mt-0.5 max-w-md truncate text-xs text-muted">{{ t.descripcion || 'Sin descripción' }}</p></td>
            <td class="p-4 text-muted">{{ t.especialidadId ? mapaEspecialidades.get(t.especialidadId) ?? '—' : '—' }}</td>
            <td class="p-4 whitespace-nowrap font-semibold text-ink">S/ {{ precioDe(t).toFixed(2) }}</td>
            <td class="p-4 whitespace-nowrap text-muted">{{ t.duracionMin }} min</td>
            <td class="p-4"><span class="rounded-full px-2.5 py-1 text-xs font-semibold" :class="t.activo ? 'bg-success/10 text-success' : 'bg-background-soft text-muted'">{{ t.activo ? 'Activo' : 'Inactivo' }}</span></td>
            <td class="p-4 whitespace-nowrap text-right"><button v-if="puedeEscribir" type="button" class="mr-2 rounded-full bg-background-soft p-2 text-primary hover:bg-primary/10" title="Editar" @click="abrirEdicion(t)"><PencilIcon class="h-4 w-4" /></button><button v-if="puedeEscribir" type="button" class="rounded-full px-3 py-1.5 text-xs font-semibold" :class="t.activo ? 'bg-error/10 text-error' : 'bg-success/10 text-success'" @click="alternar(t)">{{ t.activo ? 'Desactivar' : 'Reactivar' }}</button></td>
          </tr></tbody>
        </table>
      </div>
    </div>

    <ModalBase v-if="modalTratamiento" :titulo="editando ? 'Editar tratamiento' : 'Nuevo tratamiento'" ancho="md" @cerrar="modalTratamiento = false">
      <AvisoError v-if="errorForm" class="mb-4" :mensaje="errorForm" />
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="guardarTratamiento">
        <label class="block sm:col-span-2"><span class="mb-1 block text-xs font-medium text-ink">Nombre *</span><input v-model="form.nombre" class="w-full rounded-xl border border-line bg-background-soft/60 px-3 py-2.5" /></label>
        <label class="block sm:col-span-2"><span class="mb-1 block text-xs font-medium text-ink">Descripción</span><textarea v-model="form.descripcion" rows="2" class="w-full resize-none rounded-xl border border-line bg-background-soft/60 px-3 py-2.5" /></label>
        <label class="block sm:col-span-2"><span class="mb-1 block text-xs font-medium text-ink">Especialidad</span><select v-model="form.especialidadId" class="w-full rounded-xl border border-line bg-background-soft/60 px-3 py-2.5"><option value="">Sin especialidad</option><option v-for="e in especialidades.filter((x) => x.activo)" :key="e.id" :value="e.id">{{ e.nombre }}</option></select></label>
        <label class="block"><span class="mb-1 block text-xs font-medium text-ink">Precio (S/) *</span><input v-model="form.precio" type="number" min="0" step="0.01" inputmode="decimal" class="w-full rounded-xl border border-line bg-background-soft/60 px-3 py-2.5" /></label>
        <label class="block"><span class="mb-1 block text-xs font-medium text-ink">Duración (min) *</span><input v-model="form.duracionMin" type="number" min="5" step="5" class="w-full rounded-xl border border-line bg-background-soft/60 px-3 py-2.5" /></label>
      </form>
      <template #pie><div class="flex justify-end gap-2"><button type="button" class="rounded-full border border-line px-4 py-2 text-sm" @click="modalTratamiento = false">Cancelar</button><button type="button" :disabled="guardando" class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" @click="guardarTratamiento">{{ guardando ? 'Guardando…' : 'Guardar' }}</button></div></template>
    </ModalBase>

    <ModalBase v-if="modalEspecialidad" titulo="Nueva especialidad" ancho="sm" @cerrar="modalEspecialidad = false">
      <AvisoError v-if="errorForm" class="mb-4" :mensaje="errorForm" />
      <div class="space-y-3"><label class="block"><span class="mb-1 block text-xs font-medium">Nombre *</span><input v-model="formEspecialidad.nombre" class="w-full rounded-xl border border-line bg-background-soft/60 px-3 py-2.5" /></label><label class="block"><span class="mb-1 block text-xs font-medium">Descripción</span><textarea v-model="formEspecialidad.descripcion" rows="2" class="w-full resize-none rounded-xl border border-line bg-background-soft/60 px-3 py-2.5" /></label></div>
      <template #pie><div class="flex justify-end gap-2"><button type="button" class="rounded-full border border-line px-4 py-2 text-sm" @click="modalEspecialidad = false">Cancelar</button><button type="button" :disabled="guardando" class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" @click="guardarEspecialidad">{{ guardando ? 'Guardando…' : 'Crear especialidad' }}</button></div></template>
    </ModalBase>
  </div>
</template>
