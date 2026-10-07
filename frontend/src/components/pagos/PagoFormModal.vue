<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { listarPacientes, type Paciente } from '../../services/pacientes'
import { obtenerCita, type Cita } from '../../services/citas'
import { listarTratamientos, precioDe, type Tratamiento } from '../../services/catalogos'
import { crearPago, METODOS_PAGO, type CuotaEntrada, type Pago } from '../../services/pagos'
import { mensajeDeError } from '../../services/errores'
import { deInputFecha, hoyLocal } from '../../services/fechas'
import AvisoError from '../ui/AvisoError.vue'
import ModalBase from '../ui/ModalBase.vue'
import SelectorEntidad from '../ui/SelectorEntidad.vue'

const props = defineProps<{
  /** Cita desde la que se cobra (botón «Cobrar» de la agenda). */
  citaIdInicial?: string
}>()

const emit = defineEmits<{ creada: [Pago]; cerrar: [] }>()

const pacientes = ref<Paciente[]>([])
const tratamientos = ref<Tratamiento[]>([])
const citaOrigen = ref<Cita | null>(null)
const cargando = ref(true)
const guardando = ref(false)
const error = ref('')
const enCuotas = ref(false)
const cuotas = ref<Array<{ monto: string; fechaVencimiento: string }>>([])

const form = reactive({
  concepto: '',
  tipo: 'ingreso',
  pacienteId: '',
  tratamientoId: '',
  montoTotal: '',
  montoPagado: '',
  metodoPago: 'efectivo',
  fecha: hoyLocal(),
  observacion: '',
})

const opcionesPacientes = computed(() =>
  pacientes.value.map((p) => ({
    valor: p.id,
    etiqueta: `${p.apellidos}, ${p.nombres}${p.numDoc ? ` · ${p.numDoc}` : ''}`,
  })),
)

const opcionesTratamientos = computed(() =>
  tratamientos.value.map((t) => ({ valor: t.id, etiqueta: `${t.nombre} · S/ ${precioDe(t).toFixed(2)}` })),
)

const total = computed(() => {
  const n = Number(form.montoTotal)
  return Number.isFinite(n) ? n : 0
})

const inicial = computed(() => {
  if (form.montoPagado === '') return total.value
  const n = Number(form.montoPagado)
  return Number.isFinite(n) ? n : 0
})

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    const [p, t] = await Promise.all([listarPacientes(), listarTratamientos()])
    pacientes.value = p
    tratamientos.value = t
    if (props.citaIdInicial) {
      const cita = await obtenerCita(props.citaIdInicial)
      citaOrigen.value = cita
      form.pacienteId = cita.pacienteId
      if (cita.tratamientoId) alElegirTratamiento(cita.tratamientoId)
    }
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar el formulario')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

/**
 * Al elegir tratamiento se arma la línea de detalle y el total con su precio:
 * es el dato que ya tiene la clínica y evita teclear montos a mano.
 */
function alElegirTratamiento(valor: string): void {
  form.tratamientoId = valor
  const t = tratamientos.value.find((x) => x.id === valor)
  if (!t) return
  const precio = precioDe(t)
  form.montoTotal = String(precio)
  if (form.montoPagado === '') form.montoPagado = String(precio)
  if (!form.concepto.trim()) form.concepto = t.nombre
}

function agregarCuota(): void {
  cuotas.value.push({ monto: '', fechaVencimiento: hoyLocal() })
}

function quitarCuota(i: number): void {
  cuotas.value.splice(i, 1)
}

async function guardar(): Promise<void> {
  error.value = ''
  if (!form.concepto.trim()) {
    error.value = 'El concepto es obligatorio'
    return
  }
  if (!(total.value >= 0.01)) {
    error.value = 'El total debe ser mayor a cero'
    return
  }
  if (inicial.value > total.value) {
    error.value = 'El pago inicial no puede superar el total'
    return
  }
  const filas: CuotaEntrada[] = []
  if (enCuotas.value) {
    if (cuotas.value.length === 0) {
      error.value = 'Agrega al menos una cuota o desactiva el plan de pagos'
      return
    }
    for (let i = 0; i < cuotas.value.length; i++) {
      const f = cuotas.value[i]!
      const monto = Number(f.monto)
      if (!(monto > 0) || !f.fechaVencimiento) {
        error.value = `La cuota ${i + 1} necesita monto y vencimiento`
        return
      }
      const normalizada = deInputFecha(f.fechaVencimiento)
      if (!normalizada) {
        error.value = `La cuota ${i + 1} tiene una fecha inválida`
        return
      }
      filas.push({ nroCuota: i + 1, monto, fechaVencimiento: normalizada })
    }
  }
  guardando.value = true
  try {
    const t = tratamientos.value.find((x) => x.id === form.tratamientoId)
    const pago = await crearPago({
      concepto: form.concepto.trim(),
      tipo: form.tipo as 'ingreso' | 'egreso',
      pacienteId: form.pacienteId || undefined,
      citaId: citaOrigen.value?.id,
      montoTotal: total.value,
      montoPagado: inicial.value,
      metodoPago: form.metodoPago || undefined,
      fecha: deInputFecha(form.fecha) ?? undefined,
      observacion: form.observacion.trim() || undefined,
      detalles: t
        ? [{ descripcion: t.nombre, tratamientoId: t.id, cantidad: 1, precioUnit: precioDe(t) }]
        : undefined,
      cuotas: filas.length > 0 ? filas : undefined,
    })
    emit('creada', pago)
  } catch (e) {
    // Aquí llegan las reglas del backend: tope de montos, paciente/cita
    // inexistente, numeración del recibo.
    error.value = mensajeDeError(e, 'No se pudo registrar el pago')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalBase titulo="Nuevo pago" ancho="lg" @cerrar="emit('cerrar')">
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />
    <p v-if="cargando" class="py-6 text-center text-sm text-muted">Cargando catálogos…</p>

    <form v-else class="grid gap-3 sm:grid-cols-2" @submit.prevent="guardar">
      <div class="sm:col-span-2">
        <label class="mb-1 block text-xs font-medium text-ink">Concepto</label>
        <input
          v-model="form.concepto"
          type="text"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink">Tipo</label>
        <select
          v-model="form.tipo"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="ingreso">Ingreso</option>
          <option value="egreso">Egreso</option>
        </select>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink">Fecha</label>
        <input
          v-model="form.fecha"
          type="date"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div class="sm:col-span-2">
        <label class="mb-1 block text-xs font-medium text-ink">Paciente</label>
        <SelectorEntidad
          v-model:modelo="form.pacienteId"
          :opciones="opcionesPacientes"
          placeholder="Buscar por nombre o documento…"
          vacio="— Sin paciente —"
        />
      </div>

      <div class="sm:col-span-2">
        <label class="mb-1 block text-xs font-medium text-ink">Tratamiento</label>
        <SelectorEntidad
          :modelo="form.tratamientoId"
          :opciones="opcionesTratamientos"
          placeholder="Buscar tratamiento…"
          vacio="— Sin tratamiento —"
          @update:modelo="alElegirTratamiento"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="pago-total">Total (S/)</label>
        <input
          id="pago-total"
          v-model="form.montoTotal"
          type="number"
          min="0.01"
          step="0.01"
          inputmode="decimal"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="pago-inicial">Pago inicial (S/)</label>
        <input
          id="pago-inicial"
          v-model="form.montoPagado"
          type="number"
          min="0"
          step="0.01"
          inputmode="decimal"
          placeholder="Igual al total"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div class="sm:col-span-2">
        <label class="mb-1 block text-xs font-medium text-ink">Método de pago</label>
        <select
          v-model="form.metodoPago"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option v-for="m in METODOS_PAGO" :key="m" :value="m">{{ m }}</option>
        </select>
      </div>

      <div class="sm:col-span-2">
        <label class="flex cursor-pointer items-center gap-2 text-xs font-medium text-ink">
          <input v-model="enCuotas" type="checkbox" class="accent-primary" />
          Pagar en cuotas
        </label>
      </div>

      <div v-if="enCuotas" class="space-y-2 sm:col-span-2">
        <div
          v-for="(c, i) in cuotas"
          :key="i"
          class="grid grid-cols-[1fr_auto_auto] items-end gap-2 rounded-md border border-line p-2"
        >
          <div>
            <label class="mb-1 block text-xs text-muted">Cuota {{ i + 1 }} (S/)</label>
            <input
              v-model="c.monto"
              type="number"
              min="0.01"
              step="0.01"
              inputmode="decimal"
              class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs text-muted">Vence</label>
            <input
              v-model="c.fechaVencimiento"
              type="date"
              class="rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            type="button"
            class="rounded border border-line px-2 py-1.5 text-xs text-error hover:bg-error/10"
            @click="quitarCuota(i)"
          >
            Quitar
          </button>
        </div>
        <button
          type="button"
          class="rounded border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-background-soft"
          @click="agregarCuota"
        >
          + Agregar cuota
        </button>
      </div>

      <div class="sm:col-span-2">
        <label class="mb-1 block text-xs font-medium text-ink" for="pago-obs">Observación</label>
        <input
          id="pago-obs"
          v-model="form.observacion"
          type="text"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

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
          {{ guardando ? 'Guardando…' : 'Registrar pago' }}
        </button>
      </div>
    </form>
  </ModalBase>
</template>
