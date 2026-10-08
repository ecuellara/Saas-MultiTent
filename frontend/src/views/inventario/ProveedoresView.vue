<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ProveedorFormModal from '../../components/inventario/ProveedorFormModal.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import {
  listarProveedores,
  type Proveedor,
} from '../../services/proveedores'
import { mensajeDeError } from '../../services/errores'
import { useSessionStore } from '../../stores/session'

const sesion = useSessionStore()

const proveedores = ref<Proveedor[]>([])
const cargando = ref(true)
const error = ref('')
const busqueda = ref('')
const modalNuevo = ref(false)
const editando = ref<Proveedor | null>(null)

const puedeEscribir = computed(() => sesion.puede('inventory.write'))

const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return proveedores.value
  return proveedores.value.filter(
    (p) =>
      p.nombre.toLowerCase().includes(q) ||
      (p.ruc ?? '').toLowerCase().includes(q) ||
      (p.contacto ?? '').toLowerCase().includes(q),
  )
})

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    proveedores.value = await listarProveedores()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar los proveedores')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

async function alGuardar(): Promise<void> {
  modalNuevo.value = false
  editando.value = null
  await cargar()
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-ink">Proveedores</h2>
        <p class="mt-0.5 text-sm text-muted">{{ proveedores.length }} registrados</p>
      </div>
      <button
        v-if="puedeEscribir"
        type="button"
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
        @click="modalNuevo = true"
      >
        Nuevo proveedor
      </button>
    </header>

    <div class="mt-4">
      <input
        v-model="busqueda"
        type="text"
        placeholder="Buscar por nombre, RUC o contacto…"
        class="w-full rounded-md border border-line bg-background px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando proveedores…" />

    <EstadoVacio
      v-else-if="filtrados.length === 0"
      class="mt-4"
      titulo="Sin proveedores"
      :detalle="busqueda ? 'Ninguno coincide con la búsqueda.' : 'Registra el primero con «Nuevo proveedor».'"
    />

    <ul v-else class="mt-4 space-y-2">
      <li
        v-for="p in filtrados"
        :key="p.id"
        class="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-line bg-background p-4"
      >
        <div class="min-w-0">
          <p class="truncate text-sm font-medium text-ink">{{ p.nombre }}</p>
          <p class="mt-0.5 text-xs text-muted">
            <span v-if="p.ruc">RUC {{ p.ruc }} · </span>
            <span v-if="p.contacto">{{ p.contacto }} · </span>
            <span v-if="p.telefono">{{ p.telefono }}</span>
            <span v-if="!p.ruc && !p.contacto && !p.telefono">Sin datos de contacto</span>
          </p>
          <p v-if="p.email" class="mt-0.5 truncate text-xs text-muted">{{ p.email }}</p>
        </div>
        <button
          v-if="puedeEscribir"
          type="button"
          class="shrink-0 rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft"
          @click="editando = p"
        >
          Editar
        </button>
      </li>
    </ul>

    <ProveedorFormModal v-if="modalNuevo" @guardado="alGuardar" @cerrar="modalNuevo = false" />

    <ProveedorFormModal
      v-if="editando"
      :proveedor="editando"
      @guardado="alGuardar"
      @cerrar="editando = null"
    />
  </div>
</template>
