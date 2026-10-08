<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { listarInsumos, type Insumo } from '../../services/insumos'
import { listarProveedores, type Proveedor } from '../../services/proveedores'
import { crearCompra, totalLineas, type Compra, type LineaCompraEntrada } from '../../services/compras'
import { mensajeDeError } from '../../services/errores'
import { hoyLocal } from '../../services/fechas'
import { formatoMoneda } from '../../services/pagos'
import AvisoError from '../ui/AvisoError.vue'
import ModalBase from '../ui/ModalBase.vue'
import SelectorEntidad from '../ui/SelectorEntidad.vue'

const emit = defineEmits<{ creada: [Compra]; cerrar: [] }>()

const proveedores = ref<Proveedor[]>([])
const insumos = ref<Insumo[]>([])
const cargando = ref(true)
const guardando = ref(false)
const error = ref('')

const form = reactive({
  proveedorId: '',
  fecha: hoyLocal(),
  observacion: '',
})

const lineas = ref<Array<{ insumoId: string; cantidad: string; precioUnit: string }>>([
  { insumoId: '', cantidad: '', precioUnit: '' },
])

const opcionesProveedores = computed(() =>
  proveedores.value.map((p) => ({
    valor: p.id,
    etiqueta: p.ruc ? `${p.nombre} · ${p.ruc}` : p.nombre,
  })),
)

const opcionesInsumos = computed(() =>
  insumos.value.map((i) => ({ valor: i.id, etiqueta: `${i.nombre} (stock ${i.stockActual})` })),
)

/** Total informativo: el definitivo lo calcula el servidor en la transacción. */
const totalInformativo = computed(() =>
  totalLineas(
    lineas.value.map((l) => ({ insumoId: l.insumoId, cantidad: Number(l.cantidad) || 0, precioUnit: Number(l.precioUnit) || 0 })),
  ),
)

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    const [p, i] = await Promise.all([listarProveedores(), listarInsumos()])
    proveedores.value = p
    insumos.value = i
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar el formulario')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

function agregarLinea(): void {
  lineas.value.push({ insumoId: '', cantidad: '', precioUnit: '' })
}

function quitarLinea(i: number): void {
  lineas.value.splice(i, 1)
}

async function guardar(): Promise<void> {
  error.value = ''
  if (!form.proveedorId) {
    error.value = 'Elige un proveedor'
    return
  }
  if (lineas.value.length === 0) {
    error.value = 'Agrega al menos una línea'
    return
  }
  const detalles: LineaCompraEntrada[] = []
  for (let i = 0; i < lineas.value.length; i++) {
    const l = lineas.value[i]!
    const cantidad = Number(l.cantidad)
    const precioUnit = Number(l.precioUnit)
    if (!l.insumoId) {
      error.value = `La línea ${i + 1} no tiene insumo`
      return
    }
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      error.value = `La línea ${i + 1} necesita una cantidad entera mayor a cero`
      return
    }
    if (!(precioUnit >= 0)) {
      error.value = `La línea ${i + 1} necesita un precio válido`
      return
    }
    detalles.push({ insumoId: l.insumoId, cantidad, precioUnit })
  }
  guardando.value = true
  try {
    const compra = await crearCompra({
      proveedorId: form.proveedorId,
      fecha: form.fecha,
      observacion: form.observacion.trim() || undefined,
      detalles,
    })
    emit('creada', compra)
  } catch (e) {
    // Aquí llegan las reglas del backend: proveedor/insumo inexistente,
    // correlativos en carrera (409 → reintentar) y validación (400).
    error.value = mensajeDeError(e, 'No se pudo registrar la compra')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalBase titulo="Nueva compra" ancho="lg" @cerrar="emit('cerrar')">
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />
    <p v-if="cargando" class="py-6 text-center text-sm text-muted">Cargando catálogos…</p>

    <form v-else class="grid gap-3 sm:grid-cols-2" @submit.prevent="guardar">
      <div class="sm:col-span-2">
        <label class="mb-1 block text-xs font-medium text-ink">Proveedor</label>
        <SelectorEntidad
          v-model:modelo="form.proveedorId"
          :opciones="opcionesProveedores"
          placeholder="Buscar proveedor…"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="compra-fecha">Fecha</label>
        <input
          id="compra-fecha"
          v-model="form.fecha"
          type="date"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="compra-obs">Observación</label>
        <input
          id="compra-obs"
          v-model="form.observacion"
          type="text"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div class="space-y-2 sm:col-span-2">
        <p class="text-xs font-medium text-ink">Líneas</p>
        <div
          v-for="(l, i) in lineas"
          :key="i"
          class="grid gap-2 rounded-md border border-line p-2 sm:grid-cols-[1fr_auto_auto_auto]"
        >
          <SelectorEntidad
            v-model:modelo="l.insumoId"
            :opciones="opcionesInsumos"
            placeholder="Insumo…"
          />
          <input
            v-model="l.cantidad"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
            placeholder="Cant."
            aria-label="Cantidad"
            class="w-24 rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            v-model="l.precioUnit"
            type="number"
            min="0"
            step="0.01"
            inputmode="decimal"
            placeholder="P. unit"
            aria-label="Precio unitario"
            class="w-28 rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            class="rounded border border-line px-2 py-1.5 text-xs text-error hover:bg-error/10 disabled:opacity-60"
            :disabled="lineas.length <= 1"
            @click="quitarLinea(i)"
          >
            Quitar
          </button>
        </div>
        <div class="flex items-center justify-between">
          <button
            type="button"
            class="rounded border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-background-soft"
            @click="agregarLinea"
          >
            + Agregar línea
          </button>
          <p class="text-xs text-muted">
            Total aprox.: <strong class="text-ink">{{ formatoMoneda(totalInformativo) }}</strong>
          </p>
        </div>
      </div>

      <p class="text-xs text-muted sm:col-span-2">
        Al registrar, el stock sube y se genera el egreso en la misma operación.
      </p>

      <div class="flex justify-end gap-2 sm:col-span-2">
        <button
          type="button"
          class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
          :disabled="guardando"
          @click="emit('cerrar')"
        >
          Cancelar
        </button>
        <button
          type="submit"
          class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
          :disabled="guardando"
        >
          {{ guardando ? 'Guardando…' : 'Registrar compra' }}
        </button>
      </div>
    </form>
  </ModalBase>
</template>
