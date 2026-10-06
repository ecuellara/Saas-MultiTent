<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { mensajeDeError } from '../../services/errores'
import { formatearFecha, formatearFechaUTC } from '../../services/fechas'
import { listarOdontogramas, type Odontograma } from '../../services/pacientes'
import AvisoError from '../ui/AvisoError.vue'
import CargandoBloque from '../ui/CargandoBloque.vue'
import EstadoVacio from '../ui/EstadoVacio.vue'

const props = defineProps<{ pacienteId: string }>()

const odontogramas = ref<Odontograma[]>([])
const cargando = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    odontogramas.value = await listarOdontogramas(props.pacienteId)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar los odontogramas')
  } finally {
    cargando.value = false
  }
})

/** El editor gráfico del odontograma es el siguiente paso de este módulo. */
const ESTADOS: Record<string, string> = {
  borrador: 'Borrador',
  firmado: 'Firmado',
}
</script>

<template>
  <div class="space-y-3">
    <AvisoError v-if="error" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando odontogramas…" />

    <EstadoVacio
      v-else-if="odontogramas.length === 0"
      titulo="Sin odontogramas"
      detalle="El editor gráfico (NTS 188) todavía no está construido."
    />

    <div v-else class="overflow-x-auto rounded-lg border border-line bg-background">
      <table class="w-full text-sm">
        <thead class="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th class="px-4 py-2 font-medium">Tipo</th>
            <th class="px-4 py-2 font-medium">Versión</th>
            <th class="px-4 py-2 font-medium">Estado</th>
            <th class="px-4 py-2 font-medium">Fecha</th>
            <th class="px-4 py-2 font-medium">Firmado</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="o in odontogramas" :key="o.id" class="border-b border-line last:border-0">
            <td class="px-4 py-2 text-ink">{{ o.tipo }}</td>
            <td class="px-4 py-2 text-muted">v{{ o.version }}</td>
            <td class="px-4 py-2 text-muted">{{ ESTADOS[o.estado] ?? o.estado }}</td>
            <td class="px-4 py-2 text-muted">{{ formatearFechaUTC(o.fecha) }}</td>
            <td class="px-4 py-2 text-muted">
              {{ o.firmadoEn ? formatearFecha(o.firmadoEn) : '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
