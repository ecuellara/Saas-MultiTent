<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { mensajeDeError } from '../../services/errores'
import {
  formatearFechaUTC,
  listarHistoriales,
  type HistorialClinico,
} from '../../services/pacientes'
import AvisoError from '../ui/AvisoError.vue'
import CargandoBloque from '../ui/CargandoBloque.vue'
import EstadoVacio from '../ui/EstadoVacio.vue'

const props = defineProps<{ pacienteId: string }>()

const historiales = ref<HistorialClinico[]>([])
const cargando = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    historiales.value = await listarHistoriales(props.pacienteId)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar el historial')
  } finally {
    cargando.value = false
  }
})
</script>

<template>
  <div class="space-y-3">
    <AvisoError v-if="error" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando historial…" />

    <EstadoVacio
      v-else-if="historiales.length === 0"
      titulo="Sin atenciones registradas"
      detalle="Las atenciones se crean al cerrar una cita."
    />

    <article
      v-for="h in historiales"
      v-else
      :key="h.id"
      class="rounded-lg border border-line bg-background p-4"
    >
      <header class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="text-sm font-medium text-ink">{{ h.motivo }}</h3>
        <p class="text-xs text-muted">
          {{ formatearFechaUTC(h.fecha) }}<span v-if="h.hora"> · {{ h.hora }}</span>
        </p>
      </header>

      <dl class="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div v-if="h.sintomas">
          <dt class="text-muted">Síntomas</dt>
          <dd class="text-ink">{{ h.sintomas }}</dd>
        </div>
        <div v-if="h.diagnostico">
          <dt class="text-muted">Diagnóstico</dt>
          <dd class="text-ink">{{ h.diagnostico }}</dd>
        </div>
        <div v-if="h.tratamientoRealizado">
          <dt class="text-muted">Tratamiento realizado</dt>
          <dd class="text-ink">{{ h.tratamientoRealizado }}</dd>
        </div>
        <div v-if="h.prescripcion">
          <dt class="text-muted">Prescripción</dt>
          <dd class="text-ink">{{ h.prescripcion }}</dd>
        </div>
      </dl>
    </article>
  </div>
</template>
