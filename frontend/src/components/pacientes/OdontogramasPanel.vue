<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { mensajeDeError } from '../../services/errores'
import { deInputFecha, formatearFecha, formatearFechaUTC, hoyLocal } from '../../services/fechas'
import { crearOdontograma } from '../../services/odontogramas'
import { listarOdontogramas, type Odontograma } from '../../services/pacientes'
import AvisoError from '../ui/AvisoError.vue'
import CargandoBloque from '../ui/CargandoBloque.vue'
import EstadoVacio from '../ui/EstadoVacio.vue'

const props = defineProps<{ pacienteId: string; puedeEscribir: boolean }>()

const router = useRouter()

const odontogramas = ref<Odontograma[]>([])
const cargando = ref(true)
const creando = ref(false)
const error = ref('')

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    odontogramas.value = await listarOdontogramas(props.pacienteId)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar los odontogramas')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

/** El editor gráfico vive en `/odontograma`: aquí solo se listan versiones. */
const ESTADOS: Record<string, string> = {
  borrador: 'Borrador',
  firmado: 'Firmado',
}

function abrir(id: string): void {
  void router.push({
    name: 'odontograma',
    query: { pacienteId: props.pacienteId, odontogramaId: id },
  })
}

async function nuevo(): Promise<void> {
  error.value = ''
  const hoy = hoyLocal()
  if (!deInputFecha(hoy)) {
    error.value = 'No se pudo calcular la fecha de hoy'
    return
  }
  creando.value = true
  try {
    const creado = await crearOdontograma({
      pacienteId: props.pacienteId,
      fechaInput: hoy,
      tipo: odontogramas.value.length > 0 ? 'evolucion' : 'inicial',
      piezas: {},
    })
    await cargar()
    abrir(creado.id)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo crear el odontograma')
  } finally {
    creando.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="puedeEscribir" class="flex justify-end">
      <button
        type="button"
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
        :disabled="creando"
        @click="nuevo"
      >
        {{ creando ? 'Creando…' : 'Nuevo odontograma' }}
      </button>
    </div>

    <AvisoError v-if="error" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando odontogramas…" />

    <EstadoVacio
      v-else-if="odontogramas.length === 0"
      titulo="Sin odontogramas"
      detalle="Crea el primero con «Nuevo odontograma» para abrir el editor (NTS 188)."
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
            <th class="px-4 py-2 font-medium"><span class="sr-only">Acciones</span></th>
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
            <td class="px-4 py-2 text-right">
              <button
                type="button"
                class="rounded-md border border-line px-2.5 py-1 text-xs text-ink hover:bg-background-soft"
                @click="abrir(o.id)"
              >
                Abrir editor
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
