<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import ModalConfirmar from '../../components/ui/ModalConfirmar.vue'
import { mensajeDeError } from '../../services/errores'
import {
  actualizarClinica,
  asignarPlan,
  exportarClinica,
  listarPlanes,
  metricasClinica,
  obtenerClinica,
  type DetalleClinica,
  type MetricasClinica,
  type Plan,
} from '../../services/plataforma'

const route = useRoute()
const router = useRouter()
const id = String(route.params.id ?? '')

const clinica = ref<DetalleClinica | null>(null)
const metricas = ref<MetricasClinica | null>(null)
const planes = ref<Plan[]>([])
const planElegido = ref('')
const cargando = ref(true)
const error = ref('')
const procesando = ref(false)
const confirmarAccion = ref<'SUSPENDED' | 'ACTIVE' | null>(null)
const exportando = ref(false)

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const [c, m, p] = await Promise.all([
      obtenerClinica(id),
      metricasClinica(id),
      listarPlanes(),
    ])
    clinica.value = c
    metricas.value = m
    planes.value = p
    planElegido.value = c.suscripcion?.plan?.codigo ?? p[0]?.codigo ?? ''
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar la clínica')
  } finally {
    cargando.value = false
  }
}

async function cambiarEstado(a: 'SUSPENDED' | 'ACTIVE'): Promise<void> {
  procesando.value = true
  try {
    await actualizarClinica(id, { estado: a })
    confirmarAccion.value = null
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cambiar el estado')
  } finally {
    procesando.value = false
  }
}

async function guardarPlan(): Promise<void> {
  if (!planElegido.value) return
  procesando.value = true
  error.value = ''
  try {
    await asignarPlan(id, planElegido.value)
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo asignar el plan')
  } finally {
    procesando.value = false
  }
}

async function descargarExport(): Promise<void> {
  exportando.value = true
  error.value = ''
  try {
    const exp = await exportarClinica(id)
    const blob = new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `export-${clinica.value?.slug ?? id}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo exportar')
  } finally {
    exportando.value = false
  }
}

onMounted(cargar)
</script>

<template>
  <div class="max-w-3xl">
    <button class="mb-3 text-xs text-muted hover:text-ink" @click="router.push({ name: 'admin-clinicas' })">
      ← Volver a clínicas
    </button>

    <CargandoBloque v-if="cargando" texto="Cargando clínica…" />
    <AvisoError v-else-if="error && !clinica" :mensaje="error" />
    <div v-else-if="clinica" class="space-y-4">
      <div class="rounded-lg border border-line bg-background p-5">
        <div class="flex items-center gap-3">
          <h1 class="text-lg font-semibold text-ink">{{ clinica.nombre }}</h1>
          <span class="rounded-full bg-background-soft px-2.5 py-0.5 text-xs text-muted">{{ clinica.estado }}</span>
        </div>
        <p class="mt-1 text-xs text-muted">{{ clinica.slug }}{{ clinica.razonSocial ? ` · ${clinica.razonSocial}` : '' }}</p>
        <p class="mt-2 text-sm text-muted">
          Plan: <strong class="text-ink">{{ clinica.suscripcion?.plan?.nombre ?? 'Sin plan' }}</strong>
          <span v-if="clinica.suscripcion"> ({{ clinica.suscripcion.estado }})</span>
        </p>
        <p class="mt-1 text-sm text-muted">
          Sedes: {{ clinica.sedes.map((s) => s.nombre).join(', ') || '—' }}
        </p>
        <div v-if="metricas" class="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
          <div class="rounded-md bg-background-soft px-3 py-2"><p class="text-xs text-muted">Pacientes</p><p class="font-medium text-ink">{{ metricas.pacientes }}</p></div>
          <div class="rounded-md bg-background-soft px-3 py-2"><p class="text-xs text-muted">Citas</p><p class="font-medium text-ink">{{ metricas.citas }}</p></div>
          <div class="rounded-md bg-background-soft px-3 py-2"><p class="text-xs text-muted">Pagos pend.</p><p class="font-medium text-ink">{{ metricas.pagosPendientes }}</p></div>
          <div class="rounded-md bg-background-soft px-3 py-2"><p class="text-xs text-muted">Insumos</p><p class="font-medium text-ink">{{ metricas.insumos }}</p></div>
          <div class="rounded-md bg-background-soft px-3 py-2"><p class="text-xs text-muted">Usuarios</p><p class="font-medium text-ink">{{ metricas.usuarios }}</p></div>
        </div>
      </div>

      <div class="rounded-lg border border-line bg-background p-5">
        <h2 class="text-sm font-medium text-ink">Plan</h2>
        <div class="mt-2 flex gap-2">
          <select
            v-model="planElegido"
            class="w-full rounded-md border border-line bg-background-soft px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option v-for="p in planes" :key="p.id" :value="p.codigo">{{ p.nombre }}</option>
          </select>
          <button
            class="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
            :disabled="procesando"
            @click="guardarPlan"
          >
            Asignar
          </button>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <button
          class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
          :disabled="procesando"
          @click="confirmarAccion = clinica.estado === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'"
        >
          {{ clinica.estado === 'ACTIVE' ? 'Suspender' : 'Reactivar' }}
        </button>
        <button
          class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
          :disabled="exportando"
          @click="descargarExport"
        >
          {{ exportando ? 'Exportando…' : 'Exportar JSON' }}
        </button>
      </div>

      <AvisoError v-if="error" :mensaje="error" />
    </div>

    <ModalConfirmar
      v-if="confirmarAccion"
      :titulo="confirmarAccion === 'SUSPENDED' ? 'Suspender clínica' : 'Reactivar clínica'"
      :mensaje="confirmarAccion === 'SUSPENDED' ? 'Se bloqueará el acceso de la clínica.' : 'Se restaurará el acceso de la clínica.'"
      :texto-confirmar="confirmarAccion === 'SUSPENDED' ? 'Suspender' : 'Reactivar'"
      :peligro="confirmarAccion === 'SUSPENDED'"
      :ocupado="procesando"
      @confirmar="cambiarEstado(confirmarAccion)"
      @cancelar="confirmarAccion = null"
    />
  </div>
</template>
