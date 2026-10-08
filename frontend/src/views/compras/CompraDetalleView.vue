<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import { obtenerCompra, type Compra } from '../../services/compras'
import { obtenerProveedor } from '../../services/proveedores'
import { obtenerInsumo, type Insumo } from '../../services/insumos'
import { esNoEncontrado, mensajeDeError } from '../../services/errores'
import { formatearFechaUTC } from '../../services/fechas'
import { formatoMoneda } from '../../services/pagos'

const router = useRouter()
const route = useRoute()
const id = String(route.params.id ?? '')

const compra = ref<Compra | null>(null)
const proveedor = ref('')
const nombresInsumos = ref(new Map<string, string>())
const cargando = ref(true)
const error = ref('')
const noExiste = ref(false)

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  noExiste.value = false
  try {
    const c = await obtenerCompra(id)
    compra.value = c
    const [prov, nombres] = await Promise.all([
      obtenerProveedor(c.proveedorId).catch(() => null),
      Promise.all(
        (c.detalles ?? []).map(async (d) => {
          try {
            const insumo: Insumo = await obtenerInsumo(d.insumoId)
            return [d.insumoId, insumo.nombre] as const
          } catch {
            return [d.insumoId, 'Insumo'] as const
          }
        }),
      ),
    ])
    proveedor.value = prov?.nombre ?? 'Proveedor'
    nombresInsumos.value = new Map(nombres)
  } catch (e) {
    // 404 también significa «es de otra clínica»: no se distingue.
    if (esNoEncontrado(e)) noExiste.value = true
    else error.value = mensajeDeError(e, 'No se pudo cargar la compra')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <button class="mb-3 text-xs text-muted hover:text-ink" @click="router.push({ name: 'compras' })">
      ← Volver a compras
    </button>

    <CargandoBloque v-if="cargando" texto="Cargando compra…" />
    <EstadoVacio
      v-else-if="noExiste"
      titulo="Compra no encontrada"
      detalle="Puede que sea de otra clínica o que ya no exista."
    />
    <template v-else-if="compra">
      <AvisoError v-if="error" class="mb-4" :mensaje="error" />

      <div class="rounded-lg border border-line bg-background p-5">
        <p class="flex flex-wrap items-center gap-2">
          <span v-if="compra.codigo" class="font-mono text-xs text-muted">{{ compra.codigo }}</span>
          <span class="rounded bg-background-soft px-1.5 py-0.5 text-[10px] uppercase text-muted">
            {{ compra.estado }}
          </span>
        </p>

        <h1 class="mt-2 text-lg font-semibold text-ink">{{ proveedor }}</h1>
        <p class="mt-0.5 text-sm text-muted">{{ formatearFechaUTC(compra.fecha) }}</p>
        <p v-if="compra.observacion" class="mt-1 text-xs text-muted">{{ compra.observacion }}</p>

        <h2 class="mt-4 text-sm font-medium text-ink">Líneas</h2>
        <ul class="mt-2 divide-y divide-line rounded-md border border-line">
          <li
            v-for="d in compra.detalles ?? []"
            :key="d.id"
            class="flex items-center justify-between gap-3 px-3 py-2 text-sm"
          >
            <div class="min-w-0">
              <p class="truncate text-ink">{{ nombresInsumos.get(d.insumoId) ?? 'Insumo' }}</p>
              <p class="text-xs text-muted">{{ d.cantidad }} × {{ formatoMoneda(d.precioUnit) }}</p>
            </div>
            <p class="shrink-0 font-medium text-ink">{{ formatoMoneda(d.subtotal) }}</p>
          </li>
        </ul>

        <p class="mt-3 text-right text-sm">
          <span class="text-muted">Total: </span>
          <strong class="text-ink">{{ formatoMoneda(compra.montoTotal) }}</strong>
        </p>
      </div>
    </template>
  </div>
</template>
