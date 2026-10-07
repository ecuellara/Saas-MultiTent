<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import ModalConfirmar from '../../components/ui/ModalConfirmar.vue'
import { mensajeDeError } from '../../services/errores'
import {
  actualizarClinica,
  listarClinicas,
  type ClinicaResumen,
} from '../../services/plataforma'

const router = useRouter()
const clinicas = ref<ClinicaResumen[]>([])
const cargando = ref(true)
const error = ref('')
const accion = ref<{ id: string; nombre: string; a: 'SUSPENDED' | 'ACTIVE' } | null>(null)
const procesando = ref(false)

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    clinicas.value = await listarClinicas()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar las clínicas')
  } finally {
    cargando.value = false
  }
}

function pedirCambio(c: ClinicaResumen): void {
  accion.value = {
    id: c.id,
    nombre: c.nombre,
    a: c.estado === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
  }
}

async function confirmarCambio(): Promise<void> {
  if (!accion.value) return
  procesando.value = true
  try {
    await actualizarClinica(accion.value.id, { estado: accion.value.a })
    accion.value = null
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cambiar el estado')
  } finally {
    procesando.value = false
  }
}

function estadoClase(estado: string): string {
  if (estado === 'ACTIVE') return 'bg-primary/10 text-primary'
  if (estado === 'SUSPENDED') return 'bg-error/10 text-error'
  return 'bg-warning/10 text-warning'
}

onMounted(cargar)
</script>

<template>
  <div>
    <div class="mb-4 flex items-center gap-3">
      <h1 class="text-lg font-semibold text-ink">Clínicas</h1>
      <button
        class="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark"
        @click="router.push({ name: 'admin-clinica-alta' })"
      >
        Alta de clínica
      </button>
    </div>

    <CargandoBloque v-if="cargando" texto="Cargando clínicas…" />
    <AvisoError v-else-if="error" :mensaje="error" />
    <EstadoVacio
      v-else-if="clinicas.length === 0"
      titulo="Sin clínicas"
      detalle="Da de alta la primera con el botón superior."
    />
    <ul v-else class="space-y-2">
      <li
        v-for="c in clinicas"
        :key="c.id"
        class="flex items-center gap-3 rounded-lg border border-line bg-background px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <button
            class="block truncate text-left text-sm font-medium text-ink hover:text-primary"
            @click="router.push({ name: 'admin-clinica-detalle', params: { id: c.id } })"
          >
            {{ c.nombre }}
          </button>
          <p class="truncate text-xs text-muted">
            {{ c.slug }} · {{ c.suscripcion?.plan?.nombre ?? 'Sin plan' }}
          </p>
        </div>
        <span
          class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
          :class="estadoClase(c.estado)"
        >
          {{ c.estado }}
        </span>
        <button
          class="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-ink"
          @click="pedirCambio(c)"
        >
          {{ c.estado === 'ACTIVE' ? 'Suspender' : 'Reactivar' }}
        </button>
      </li>
    </ul>

    <ModalConfirmar
      v-if="accion"
      :titulo="accion.a === 'SUSPENDED' ? 'Suspender clínica' : 'Reactivar clínica'"
      :mensaje="
        accion.a === 'SUSPENDED'
          ? `Se bloqueará el acceso de ${accion.nombre} hasta reactivarla.`
          : `Se restaurará el acceso de ${accion.nombre}.`
      "
      :texto-confirmar="accion.a === 'SUSPENDED' ? 'Suspender' : 'Reactivar'"
      :peligro="accion.a === 'SUSPENDED'"
      :ocupado="procesando"
      @confirmar="confirmarCambio"
      @cancelar="accion = null"
    />
  </div>
</template>
