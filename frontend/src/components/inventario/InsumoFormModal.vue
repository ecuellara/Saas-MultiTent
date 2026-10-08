<script setup lang="ts">
import { reactive, ref } from 'vue'
import { crearInsumo, UNIDADES, type Insumo } from '../../services/insumos'
import { mensajeDeError } from '../../services/errores'
import AvisoError from '../ui/AvisoError.vue'
import ModalBase from '../ui/ModalBase.vue'

/**
 * Alta de insumo. No hay edición de datos maestros: el backend no expone
 * `PATCH /insumos/:id` (devuelve 400) y el stock solo se mueve con
 * entradas/salidas, así que este formulario es solo de creación.
 */
const emit = defineEmits<{ creado: [Insumo]; cerrar: [] }>()

const form = reactive({
  nombre: '',
  unidad: 'und',
  stockActual: '',
  stockMinimo: '',
})

const guardando = ref(false)
const error = ref('')

function aEnteroOIndef(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : undefined
}

async function guardar(): Promise<void> {
  error.value = ''
  if (!form.nombre.trim()) {
    error.value = 'El nombre es obligatorio'
    return
  }
  const stockActual = form.stockActual.trim() === '' ? undefined : aEnteroOIndef(form.stockActual)
  const stockMinimo = form.stockMinimo.trim() === '' ? undefined : aEnteroOIndef(form.stockMinimo)
  if (form.stockActual.trim() !== '' && stockActual === undefined) {
    error.value = 'El stock inicial debe ser un entero mayor o igual a cero'
    return
  }
  if (form.stockMinimo.trim() !== '' && stockMinimo === undefined) {
    error.value = 'El stock mínimo debe ser un entero mayor o igual a cero'
    return
  }
  guardando.value = true
  try {
    const creado = await crearInsumo({
      nombre: form.nombre.trim(),
      unidad: form.unidad.trim() || undefined,
      stockActual,
      stockMinimo,
    })
    emit('creado', creado)
  } catch (e) {
    // Aquí llegan las reglas del backend: nombre duplicado en la sede (409)
    // y validación del cuerpo (400).
    error.value = mensajeDeError(e, 'No se pudo crear el insumo')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalBase titulo="Nuevo insumo" ancho="sm" @cerrar="emit('cerrar')">
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />

    <form class="grid gap-3" @submit.prevent="guardar">
      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="insumo-nombre">Nombre</label>
        <input
          id="insumo-nombre"
          v-model="form.nombre"
          type="text"
          placeholder="Guantes látex (caja x100)"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="insumo-unidad">Unidad</label>
          <input
            id="insumo-unidad"
            v-model="form.unidad"
            type="text"
            list="unidades-insumo"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <datalist id="unidades-insumo">
            <option v-for="u in UNIDADES" :key="u" :value="u" />
          </datalist>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="insumo-minimo">Stock mínimo</label>
          <input
            id="insumo-minimo"
            v-model="form.stockMinimo"
            type="number"
            min="0"
            step="1"
            inputmode="numeric"
            placeholder="0"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="insumo-inicial">Stock inicial</label>
        <input
          id="insumo-inicial"
          v-model="form.stockActual"
          type="number"
          min="0"
          step="1"
          inputmode="numeric"
          placeholder="0"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <p class="mt-1 text-xs text-muted">Después solo se mueve con entradas y salidas.</p>
      </div>

      <div class="flex justify-end gap-2">
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
          {{ guardando ? 'Guardando…' : 'Crear insumo' }}
        </button>
      </div>
    </form>
  </ModalBase>
</template>
