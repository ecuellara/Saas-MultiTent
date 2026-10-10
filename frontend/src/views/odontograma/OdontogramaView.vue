<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import OdontogramaEditor from '../../components/odontograma/OdontogramaEditor.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import SelectorEntidad from '../../components/ui/SelectorEntidad.vue'
import { mensajeDeError } from '../../services/errores'
import { deInputFecha, formatearFechaUTC, hoyLocal } from '../../services/fechas'
import {
  crearOdontograma,
} from '../../services/odontogramas'
import { listarOdontogramas, listarPacientes, type Odontograma, type Paciente } from '../../services/pacientes'
import { useSessionStore } from '../../stores/session'

/**
 * Pantalla del odontograma: selector de paciente, versiones y editor.
 *
 * El uso diario vive en la ficha del paciente (`OdontogramasPanel`, que
 * enlaza aquí con `?pacienteId=…&odontogramaId=…`); esta pantalla es la
 * puerta de entrada cuando se llega desde el menú.
 */
const route = useRoute()
const router = useRouter()
const sesion = useSessionStore()

const pacientes = ref<Paciente[]>([])
const versiones = ref<Odontograma[]>([])
const cargandoPacientes = ref(true)
const cargandoVersiones = ref(false)
const creando = ref(false)
const error = ref('')

const pacienteId = ref(
  typeof route.query.pacienteId === 'string' ? route.query.pacienteId : '',
)
const odontogramaId = ref(
  typeof route.query.odontogramaId === 'string' ? route.query.odontogramaId : '',
)

/** La interfaz solo oculta: el permiso real lo exige el servidor. */
const puedeEscribir = computed(() => sesion.puede('patients.write'))

const opcionesPacientes = computed(() =>
  pacientes.value.map((p) => ({
    valor: p.id,
    etiqueta: `${p.apellidos}, ${p.nombres}${p.numDoc ? ` · ${p.numDoc}` : ''}`,
  })),
)

function sincronizarRuta(): void {
  void router.replace({
    name: 'odontograma',
    query: {
      ...(pacienteId.value ? { pacienteId: pacienteId.value } : {}),
      ...(odontogramaId.value ? { odontogramaId: odontogramaId.value } : {}),
    },
  })
}

async function cargarVersiones(): Promise<void> {
  if (!pacienteId.value) {
    versiones.value = []
    return
  }
  cargandoVersiones.value = true
  error.value = ''
  try {
    versiones.value = await listarOdontogramas(pacienteId.value)
    if (odontogramaId.value && !versiones.value.some((v) => v.id === odontogramaId.value)) {
      odontogramaId.value = ''
    }
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar las versiones')
  } finally {
    cargandoVersiones.value = false
  }
}

onMounted(async () => {
  try {
    pacientes.value = await listarPacientes()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar los pacientes')
  } finally {
    cargandoPacientes.value = false
  }
  if (pacienteId.value) await cargarVersiones()
})

watch(pacienteId, async () => {
  odontogramaId.value = ''
  await cargarVersiones()
  sincronizarRuta()
})

watch(odontogramaId, sincronizarRuta)

function elegirVersion(id: string): void {
  odontogramaId.value = id
}

async function nuevo(): Promise<void> {
  if (!pacienteId.value) return
  error.value = ''
  const hoy = hoyLocal()
  if (!deInputFecha(hoy)) {
    error.value = 'No se pudo calcular la fecha de hoy'
    return
  }
  creando.value = true
  try {
    const creado = await crearOdontograma({
      pacienteId: pacienteId.value,
      fechaInput: hoy,
      tipo: versiones.value.length > 0 ? 'evolucion' : 'inicial',
      piezas: {},
    })
    await cargarVersiones()
    odontogramaId.value = creado.id
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo crear el odontograma')
  } finally {
    creando.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-ink">Odontograma</h2>
      <button
        v-if="pacienteId && puedeEscribir"
        type="button"
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
        :disabled="creando"
        @click="nuevo"
      >
        {{ creando ? 'Creando…' : 'Nuevo odontograma' }}
      </button>
    </header>

    <AvisoError v-if="error" :mensaje="error" />
    <CargandoBloque v-if="cargandoPacientes" texto="Cargando pacientes…" />

    <template v-else>
      <div class="max-w-md">
        <label class="mb-1 block text-xs font-medium text-ink">Paciente</label>
        <SelectorEntidad
          v-model:modelo="pacienteId"
          :opciones="opcionesPacientes"
          placeholder="Buscar por nombre o documento…"
        />
      </div>

      <EstadoVacio
        v-if="!pacienteId"
        titulo="Sin paciente"
        detalle="Elige un paciente para ver sus versiones o crear la primera."
      />

      <template v-else>
        <CargandoBloque v-if="cargandoVersiones" texto="Cargando versiones…" />

        <EstadoVacio
          v-else-if="versiones.length === 0"
          titulo="Sin odontogramas"
          detalle="Crea el primero con «Nuevo odontograma»."
        />

        <template v-else>
          <div class="flex flex-wrap gap-2" role="tablist" aria-label="Versiones">
            <button
              v-for="v in versiones"
              :key="v.id"
              type="button"
              role="tab"
              class="rounded-md border px-3 py-1.5 text-sm"
              :class="
                odontogramaId === v.id
                  ? 'border-primary ring-2 ring-primary'
                  : 'border-line hover:bg-background-soft'
              "
              @click="elegirVersion(v.id)"
            >
              <span class="font-medium text-ink">v{{ v.version }}</span>
              <span class="ml-1 text-xs text-muted">
                {{ v.tipo }} · {{ formatearFechaUTC(v.fecha) }}{{ v.estado === 'firmado' ? ' · firmado' : '' }}
              </span>
            </button>
          </div>

          <EstadoVacio
            v-if="!odontogramaId"
            titulo="Sin versión elegida"
            detalle="Elige una versión para abrir el editor."
          />
          <OdontogramaEditor
            v-else
            :key="odontogramaId"
            :odontograma-id="odontogramaId"
            @actualizado="cargarVersiones"
          />
        </template>
      </template>
    </template>
  </div>
</template>
