<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import InsumoFormModal from '../../components/inventario/InsumoFormModal.vue'
import MovimientoModal from '../../components/inventario/MovimientoModal.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import {
  bajoMinimo,
  listarInsumos,
  type Insumo,
} from '../../services/insumos'
import { mensajeDeError } from '../../services/errores'
import { formatoMoneda } from '../../services/pagos'
import { useSessionStore } from '../../stores/session'

const sesion = useSessionStore()

const insumos = ref<Insumo[]>([])
const cargando = ref(true)
const error = ref('')
const busqueda = ref('')
const soloBajoMinimo = ref(false)
const modalNuevo = ref(false)
const movimiento = ref<{ insumo: Insumo; tipo: 'entrada' | 'salida' } | null>(null)

const puedeEscribir = computed(() => sesion.puede('inventory.write'))

const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  return insumos.value.filter((i) => {
    if (soloBajoMinimo.value && !bajoMinimo(i)) return false
    if (!q) return true
    return i.nombre.toLowerCase().includes(q) || i.unidad.toLowerCase().includes(q)
  })
})

const nBajoMinimo = computed(() => insumos.value.filter(bajoMinimo).length)

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    insumos.value = await listarInsumos()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar el inventario')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

async function alCrear(): Promise<void> {
  modalNuevo.value = false
  await cargar()
}

async function alMover(): Promise<void> {
  movimiento.value = null
  await cargar()
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-ink">Inventario</h2>
        <p class="mt-0.5 text-sm text-muted">
          {{ insumos.length }} insumos<span v-if="nBajoMinimo > 0"> · {{ nBajoMinimo }} bajo mínimo</span>
        </p>
      </div>
      <button
        v-if="puedeEscribir"
        type="button"
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
        @click="modalNuevo = true"
      >
        Nuevo insumo
      </button>
    </header>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <input
        v-model="busqueda"
        type="text"
        placeholder="Buscar por nombre o unidad…"
        class="min-w-0 flex-1 rounded-md border border-line bg-background px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
      />
      <label class="flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input v-model="soloBajoMinimo" type="checkbox" class="accent-primary" />
        Solo bajo mínimo
      </label>
    </div>

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando inventario…" />

    <EstadoVacio
      v-else-if="filtrados.length === 0"
      class="mt-4"
      titulo="Sin insumos"
      :detalle="busqueda || soloBajoMinimo ? 'Ningún insumo coincide con el filtro.' : 'Registra el primero con «Nuevo insumo».'"
    />

    <ul v-else class="mt-4 space-y-2">
      <li
        v-for="i in filtrados"
        :key="i.id"
        class="rounded-lg border border-line bg-background p-4"
        :class="bajoMinimo(i) && 'border-warning'"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2">
              <span class="truncate text-sm font-medium text-ink">{{ i.nombre }}</span>
              <span
                v-if="bajoMinimo(i)"
                class="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-warning"
              >
                Bajo mínimo
              </span>
            </p>
            <p class="mt-0.5 text-xs text-muted">
              Stock {{ i.stockActual }} {{ i.unidad }} · mín. {{ i.stockMinimo }}
              <span v-if="i.precioRef !== null"> · ref. {{ formatoMoneda(i.precioRef) }}</span>
            </p>
          </div>

          <div v-if="puedeEscribir" class="flex shrink-0 flex-wrap gap-1">
            <button
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-success hover:bg-success/10"
              @click="movimiento = { insumo: i, tipo: 'entrada' }"
            >
              Entrada
            </button>
            <button
              type="button"
              class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft"
              @click="movimiento = { insumo: i, tipo: 'salida' }"
            >
              Salida
            </button>
          </div>
        </div>
      </li>
    </ul>

    <InsumoFormModal v-if="modalNuevo" @creado="alCrear" @cerrar="modalNuevo = false" />

    <MovimientoModal
      v-if="movimiento"
      :insumo="movimiento.insumo"
      :tipo="movimiento.tipo"
      @actualizado="alMover"
      @cerrar="movimiento = null"
    />
  </div>
</template>
