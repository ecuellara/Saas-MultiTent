<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  registrarEntrada,
  registrarSalida,
  type Insumo,
} from '../../services/insumos'
import { mensajeDeError } from '../../services/errores'
import AvisoError from '../ui/AvisoError.vue'
import ModalBase from '../ui/ModalBase.vue'

const props = defineProps<{
  insumo: Insumo
  /** 'entrada' suma stock, 'salida' resta (con tope en existencias). */
  tipo: 'entrada' | 'salida'
}>()

const emit = defineEmits<{ actualizado: [Insumo]; cerrar: [] }>()

const form = reactive({ cantidad: '', motivo: '' })
const guardando = ref(false)
const error = ref('')

const esEntrada = props.tipo === 'entrada'

async function guardar(): Promise<void> {
  error.value = ''
  const cantidad = Number(form.cantidad)
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    error.value = 'La cantidad debe ser un entero mayor a cero'
    return
  }
  if (!esEntrada && cantidad > props.insumo.stockActual) {
    error.value = `Sin stock suficiente (hay ${props.insumo.stockActual})`
    return
  }
  guardando.value = true
  try {
    const actualizado = esEntrada
      ? await registrarEntrada(props.insumo.id, {
          cantidad,
          motivo: form.motivo.trim() || undefined,
        })
      : await registrarSalida(props.insumo.id, {
          cantidad,
          motivo: form.motivo.trim() || undefined,
        })
    emit('actualizado', actualizado)
  } catch (e) {
    // Aquí llegan las reglas del backend: stock insuficiente y carreras
    // concurrentes (409 → reintentar recargando).
    error.value = mensajeDeError(e, 'No se pudo registrar el movimiento')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalBase :titulo="esEntrada ? 'Registrar entrada' : 'Registrar salida'" ancho="sm" @cerrar="emit('cerrar')">
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />

    <p class="mb-4 text-xs text-muted">
      {{ insumo.nombre }} · stock actual: <strong class="text-ink">{{ insumo.stockActual }}</strong>
    </p>

    <form class="grid gap-3" @submit.prevent="guardar">
      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="mov-cantidad">Cantidad</label>
        <input
          id="mov-cantidad"
          v-model="form.cantidad"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="mov-motivo">Motivo (opcional)</label>
        <input
          id="mov-motivo"
          v-model="form.motivo"
          type="text"
          placeholder="Ajuste, uso en tratamiento…"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
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
          {{ guardando ? 'Guardando…' : esEntrada ? 'Registrar entrada' : 'Registrar salida' }}
        </button>
      </div>
    </form>
  </ModalBase>
</template>
