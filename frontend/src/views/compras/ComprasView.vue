<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import CompraFormModal from '../../components/compras/CompraFormModal.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import {
  listarCompras,
  type Compra,
} from '../../services/compras'
import { listarProveedores, type Proveedor } from '../../services/proveedores'
import { mensajeDeError } from '../../services/errores'
import { formatearFechaUTC } from '../../services/fechas'
import { formatoMoneda } from '../../services/pagos'
import { useSessionStore } from '../../stores/session'

const sesion = useSessionStore()
const router = useRouter()

const compras = ref<Compra[]>([])
const proveedores = ref<Proveedor[]>([])
const cargando = ref(true)
const error = ref('')
const modalNueva = ref(false)

const puedeEscribir = computed(() => sesion.puede('inventory.write'))

const mapaProveedores = computed(() => new Map(proveedores.value.map((p) => [p.id, p.nombre])))

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const [c, p] = await Promise.all([listarCompras(), listarProveedores()])
    compras.value = c
    proveedores.value = p
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar las compras')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

async function alCrear(creada: Compra): Promise<void> {
  modalNueva.value = false
  await router.push({ name: 'compra-detalle', params: { id: creada.id } })
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-ink">Compras</h2>
        <p class="mt-0.5 text-sm text-muted">{{ compras.length }} registradas</p>
      </div>
      <button
        v-if="puedeEscribir"
        type="button"
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
        @click="modalNueva = true"
      >
        Nueva compra
      </button>
    </header>

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando compras…" />

    <EstadoVacio
      v-else-if="compras.length === 0"
      class="mt-4"
      titulo="Sin compras"
      detalle="Registra la primera con «Nueva compra»: sube el stock y genera el egreso."
    />

    <ul v-else class="mt-4 space-y-2">
      <li
        v-for="c in compras"
        :key="c.id"
        class="rounded-lg border border-line bg-background p-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="flex flex-wrap items-center gap-2">
              <span v-if="c.codigo" class="font-mono text-xs text-muted">{{ c.codigo }}</span>
              <span class="rounded bg-background-soft px-1.5 py-0.5 text-[10px] uppercase text-muted">
                {{ c.estado }}
              </span>
            </p>
            <button
              class="mt-1 block truncate text-left text-sm font-medium text-ink hover:text-primary"
              @click="router.push({ name: 'compra-detalle', params: { id: c.id } })"
            >
              {{ mapaProveedores.get(c.proveedorId) ?? 'Proveedor' }}
            </button>
            <p class="mt-0.5 text-xs text-muted">{{ formatearFechaUTC(c.fecha) }}</p>
          </div>
          <p class="shrink-0 text-sm font-medium text-ink">{{ formatoMoneda(c.montoTotal) }}</p>
        </div>
      </li>
    </ul>

    <CompraFormModal v-if="modalNueva" @creada="alCrear" @cerrar="modalNueva = false" />
  </div>
</template>
