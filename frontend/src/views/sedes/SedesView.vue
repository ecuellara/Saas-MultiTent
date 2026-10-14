<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import ModalBase from '../../components/ui/ModalBase.vue'
import {
  actualizarSede,
  crearSede,
  listarSedes,
  type Sede,
} from '../../services/sedes'
import { mensajeDeError } from '../../services/errores'
import { useSessionStore } from '../../stores/session'
import { BuildingOffice2Icon } from '@heroicons/vue/24/outline'
import ModuloHero from '../../components/ui/ModuloHero.vue'

/**
 * Pantalla de sedes: listado, alta y edición (incluido el interruptor de
 * `activo`). La lectura está abierta a propósito; crear y editar exigen
 * `sedes.manage` en el servidor (aquí solo se ocultan los botones).
 */
const sesion = useSessionStore()

const sedes = ref<Sede[]>([])
const cargando = ref(true)
const error = ref('')
const busqueda = ref('')
const modalNuevo = ref(false)
const editando = ref<Sede | null>(null)
const guardando = ref(false)
const errorForm = ref('')

const puedeEscribir = computed(() => sesion.puede('sedes.manage'))

const form = ref({ nombre: '', direccion: '', telefono: '', activo: true })

const filtradas = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return sedes.value
  return sedes.value.filter(
    (s) =>
      s.nombre.toLowerCase().includes(q) ||
      (s.direccion ?? '').toLowerCase().includes(q) ||
      (s.telefono ?? '').toLowerCase().includes(q),
  )
})

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    sedes.value = await listarSedes()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar las sedes')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

function abrirNuevo(): void {
  form.value = { nombre: '', direccion: '', telefono: '', activo: true }
  errorForm.value = ''
  modalNuevo.value = true
}

function abrirEdicion(sede: Sede): void {
  form.value = {
    nombre: sede.nombre,
    direccion: sede.direccion ?? '',
    telefono: sede.telefono ?? '',
    activo: sede.activo,
  }
  errorForm.value = ''
  editando.value = sede
}

/**
 * Los blancos viajan como `undefined` (el PATCH no toca lo no enviado);
 * `activo` siempre se envía en edición porque el interruptor es explícito.
 */
async function guardar(): Promise<void> {
  errorForm.value = ''
  const nombre = form.value.nombre.trim()
  if (!nombre) {
    errorForm.value = 'El nombre es obligatorio'
    return
  }
  const recortar = (v: string): string | undefined => {
    const t = v.trim()
    return t === '' ? undefined : t
  }
  guardando.value = true
  try {
    if (editando.value) {
      await actualizarSede(editando.value.id, {
        nombre,
        direccion: recortar(form.value.direccion),
        telefono: recortar(form.value.telefono),
        activo: form.value.activo,
      })
      editando.value = null
    } else {
      await crearSede({
        nombre,
        direccion: recortar(form.value.direccion),
        telefono: recortar(form.value.telefono),
      })
      modalNuevo.value = false
    }
    await cargar()
  } catch (e) {
    errorForm.value = mensajeDeError(e, 'No se pudo guardar la sede')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <ModuloHero etiqueta="Administración" titulo="Sedes" descripcion="Organiza las ubicaciones, teléfonos y estado operativo de la clínica." :icono="BuildingOffice2Icon" :metrica="String(sedes.length)" metrica-etiqueta="Registradas">
      <button
        v-if="puedeEscribir"
        type="button"
        class="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark"
        @click="abrirNuevo"
      >
        Nueva sede
      </button>
    </ModuloHero>

    <div class="rounded-[28px] border border-line bg-background p-4 shadow-sm">
      <input
        v-model="busqueda"
        type="text"
        placeholder="Buscar por nombre, dirección o teléfono…"
        class="w-full rounded-2xl border border-line bg-background-soft/60 px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando sedes…" />

    <EstadoVacio
      v-else-if="filtradas.length === 0"
      class="mt-4"
      titulo="Sin sedes"
      :detalle="busqueda ? 'Ninguna coincide con la búsqueda.' : 'Registra la primera con «Nueva sede».'"
    />

    <ul v-else class="grid gap-3 md:grid-cols-2">
      <li
        v-for="s in filtradas"
        :key="s.id"
        class="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-line bg-background p-4 shadow-sm"
      >
        <div class="min-w-0">
          <p class="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
            {{ s.nombre }}
            <span
              v-if="s.esPrincipal"
              class="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
            >
              Principal
            </span>
            <span
              class="rounded px-1.5 py-0.5 text-[10px] font-medium"
              :class="s.activo ? 'bg-success/10 text-success' : 'bg-background-soft text-muted'"
            >
              {{ s.activo ? 'Activa' : 'Inactiva' }}
            </span>
          </p>
          <p class="mt-0.5 text-xs text-muted">
            <span v-if="s.direccion">{{ s.direccion }} · </span>
            <span v-if="s.telefono">{{ s.telefono }}</span>
            <span v-if="!s.direccion && !s.telefono">Sin datos de contacto</span>
          </p>
        </div>
        <button
          v-if="puedeEscribir"
          type="button"
          class="shrink-0 rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft"
          @click="abrirEdicion(s)"
        >
          Editar
        </button>
      </li>
    </ul>

    <ModalBase
      v-if="modalNuevo || editando"
      :titulo="editando ? 'Editar sede' : 'Nueva sede'"
      ancho="sm"
      @cerrar="modalNuevo = false; editando = null"
    >
      <AvisoError v-if="errorForm" class="mb-4" :mensaje="errorForm" />
      <form class="grid gap-3" @submit.prevent="guardar">
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="sede-nombre">Nombre</label>
          <input
            id="sede-nombre"
            v-model="form.nombre"
            type="text"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="sede-direccion">Dirección</label>
          <input
            id="sede-direccion"
            v-model="form.direccion"
            type="text"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="sede-telefono">Teléfono</label>
          <input
            id="sede-telefono"
            v-model="form.telefono"
            type="text"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <label v-if="editando" class="flex cursor-pointer items-center gap-2 text-sm text-ink">
          <input v-model="form.activo" type="checkbox" class="h-4 w-4 shrink-0 accent-primary" />
          Sede activa
        </label>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
            :disabled="guardando"
            @click="modalNuevo = false; editando = null"
          >
            Cancelar
          </button>
          <button
            type="submit"
            class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
            :disabled="guardando"
          >
            {{ guardando ? 'Guardando…' : editando ? 'Guardar cambios' : 'Crear sede' }}
          </button>
        </div>
      </form>
    </ModalBase>
  </div>
</template>
