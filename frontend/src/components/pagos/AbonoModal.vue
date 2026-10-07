<script setup lang="ts">
import { reactive, ref } from 'vue'
import { formatoMoneda, METODOS_PAGO, num, registrarAbono, type Pago } from '../../services/pagos'
import { mensajeDeError } from '../../services/errores'
import { hoyLocal } from '../../services/fechas'
import AvisoError from '../ui/AvisoError.vue'
import ModalBase from '../ui/ModalBase.vue'

const props = defineProps<{ pago: Pago }>()

const emit = defineEmits<{ actualizado: [Pago]; cerrar: [] }>()

const form = reactive({
  monto: '',
  metodoPago: props.pago.metodoPago ?? 'efectivo',
  fecha: hoyLocal(),
})

const guardando = ref(false)
const error = ref('')

const saldo = num(props.pago.saldo)

async function guardar(): Promise<void> {
  error.value = ''
  const monto = Number(form.monto)
  if (!(monto > 0)) {
    error.value = 'El monto debe ser mayor a cero'
    return
  }
  if (monto > saldo) {
    error.value = `El abono no puede superar el saldo (${formatoMoneda(saldo)})`
    return
  }
  guardando.value = true
  try {
    const actualizado = await registrarAbono(props.pago.id, {
      monto,
      metodoPago: form.metodoPago || undefined,
      fecha: form.fecha || undefined,
    })
    emit('actualizado', actualizado)
  } catch (e) {
    // Aquí llegan las reglas del backend: tope del total y carreras entre
    // abonos concurrentes (409 → reintentar).
    error.value = mensajeDeError(e, 'No se pudo registrar el abono')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalBase titulo="Registrar abono" ancho="sm" @cerrar="emit('cerrar')">
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />

    <p class="mb-4 text-xs text-muted">
      Saldo pendiente: <strong class="text-ink">{{ formatoMoneda(saldo) }}</strong>
    </p>

    <form class="grid gap-3" @submit.prevent="guardar">
      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="abono-monto">Monto (S/)</label>
        <input
          id="abono-monto"
          v-model="form.monto"
          type="number"
          min="0.01"
          step="0.01"
          inputmode="decimal"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink">Método de pago</label>
        <select
          v-model="form.metodoPago"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option v-for="m in METODOS_PAGO" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="abono-fecha">Fecha</label>
        <input
          id="abono-fecha"
          v-model="form.fecha"
          type="date"
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
          {{ guardando ? 'Guardando…' : 'Registrar' }}
        </button>
      </div>
    </form>
  </ModalBase>
</template>
