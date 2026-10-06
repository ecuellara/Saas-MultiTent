<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import DocumentosPanel from '../../components/pacientes/DocumentosPanel.vue'
import HistorialPanel from '../../components/pacientes/HistorialPanel.vue'
import OdontogramasPanel from '../../components/pacientes/OdontogramasPanel.vue'
import PacienteFormModal from '../../components/pacientes/PacienteFormModal.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import { mensajeDeError } from '../../services/errores'
import {
  calcularEdad,
  formatearFecha,
  formatearFechaUTC,
  obtenerPaciente,
  type Paciente,
} from '../../services/pacientes'
import { useSessionStore } from '../../stores/session'

const route = useRoute()
const sesion = useSessionStore()

const pacienteId = computed(() => String(route.params.id ?? ''))

const paciente = ref<Paciente | null>(null)
const cargando = ref(true)
const error = ref('')
const modalEdicion = ref(false)

type Pestana = 'datos' | 'historial' | 'documentos' | 'odontogramas'
const pestana = ref<Pestana>('datos')

const PESTANAS: Array<{ clave: Pestana; etiqueta: string }> = [
  { clave: 'datos', etiqueta: 'Datos' },
  { clave: 'historial', etiqueta: 'Historial' },
  { clave: 'documentos', etiqueta: 'Documentos' },
  { clave: 'odontogramas', etiqueta: 'Odontogramas' },
]

const puedeEscribir = computed(() => sesion.puede('patients.write'))

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    paciente.value = await obtenerPaciente(pacienteId.value)
  } catch (e) {
    // 404 también significa «es de otra clínica»: el backend no revela cuál.
    error.value = mensajeDeError(e, 'No se pudo cargar el paciente')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

/** Bloques de la pestaña Datos, en el orden en que se leen en la ficha. */
const bloques = computed(() => {
  const p = paciente.value
  if (!p) return []
  return [
    {
      titulo: 'Identificación',
      filas: [
        ['Documento', p.numDoc ? `${p.tipoDoc} ${p.numDoc}` : '—'],
        ['Fecha de nacimiento', formatearFechaUTC(p.fechaNac)],
        ['Edad', calcularEdad(p.fechaNac)?.toString() ?? '—'],
        ['Sexo', p.sexo ?? '—'],
        ['Grupo sanguíneo', p.grupoSanguineo ?? '—'],
      ],
    },
    {
      titulo: 'Contacto',
      filas: [
        ['Teléfono', p.telefono ?? '—'],
        ['Correo', p.email ?? '—'],
        ['Dirección', p.direccion ?? '—'],
        ['Ubigeo', p.ubigeoCodigo ?? '—'],
      ],
    },
    {
      titulo: 'Contacto de emergencia',
      filas: [
        ['Nombre', p.contactoEmergenciaNombre ?? '—'],
        ['Teléfono', p.contactoEmergenciaTelefono ?? '—'],
      ],
    },
    {
      titulo: 'Representante legal',
      filas: [
        ['Nombre', p.representanteNombre ?? '—'],
        ['DNI', p.representanteDni ?? '—'],
        ['Parentesco', p.representanteParentesco ?? '—'],
        ['Domicilio', p.representanteDomicilio ?? '—'],
      ],
    },
    {
      titulo: 'Antecedentes clínicos',
      filas: [
        ['Alergias', p.alergias ?? '—'],
        ['Enfermedades', p.enfermedades ?? '—'],
        ['Medicamentos', p.medicamentos ?? '—'],
        ['Hábitos', p.habitos ?? '—'],
        ['Antecedentes', p.antecedentes ?? '—'],
      ],
    },
  ]
})

async function alGuardar(): Promise<void> {
  modalEdicion.value = false
  await cargar()
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <RouterLink
      :to="{ name: 'pacientes' }"
      class="text-xs text-primary hover:underline"
    >
      ← Pacientes
    </RouterLink>

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando expediente…" />

    <template v-else-if="paciente">
      <header class="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-lg font-semibold text-ink">
            {{ paciente.apellidos }}, {{ paciente.nombres }}
            <span
              v-if="!paciente.activo"
              class="ml-2 rounded bg-warning/15 px-1.5 py-0.5 align-middle text-[10px] uppercase text-warning"
            >
              Inactivo
            </span>
          </h2>
          <p class="mt-0.5 text-sm text-muted">
            <span v-if="paciente.numDoc">{{ paciente.tipoDoc }} {{ paciente.numDoc }} · </span>
            <span v-if="paciente.telefono">{{ paciente.telefono }} · </span>
            Alta {{ formatearFecha(paciente.createdAt) }}
          </p>
        </div>
        <button
          v-if="puedeEscribir"
          type="button"
          class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft"
          @click="modalEdicion = true"
        >
          Editar
        </button>
      </header>

      <nav class="mt-5 flex gap-1 border-b border-line">
        <button
          v-for="t in PESTANAS"
          :key="t.clave"
          type="button"
          class="-mb-px border-b-2 px-3 py-2 text-sm transition-colors"
          :class="
            pestana === t.clave
              ? 'border-primary font-medium text-primary'
              : 'border-transparent text-muted hover:text-ink'
          "
          @click="pestana = t.clave"
        >
          {{ t.etiqueta }}
        </button>
      </nav>

      <div class="mt-5">
        <div v-if="pestana === 'datos'" class="grid gap-4 sm:grid-cols-2">
          <section
            v-for="bloque in bloques"
            :key="bloque.titulo"
            class="rounded-lg border border-line bg-background p-4"
          >
            <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
              {{ bloque.titulo }}
            </h3>
            <dl class="mt-3 space-y-2 text-sm">
              <div v-for="fila in bloque.filas" :key="fila[0]" class="flex justify-between gap-4">
                <dt class="shrink-0 text-muted">{{ fila[0] }}</dt>
                <dd class="min-w-0 break-words text-right text-ink">{{ fila[1] }}</dd>
              </div>
            </dl>
          </section>
        </div>

        <HistorialPanel
          v-else-if="pestana === 'historial'"
          :paciente-id="pacienteId"
        />

        <DocumentosPanel
          v-else-if="pestana === 'documentos'"
          :paciente-id="pacienteId"
          :puede-escribir="puedeEscribir"
        />

        <OdontogramasPanel v-else :paciente-id="pacienteId" />
      </div>

      <PacienteFormModal
        v-if="modalEdicion"
        :paciente="paciente"
        @guardado="alGuardar"
        @cerrar="modalEdicion = false"
      />
    </template>
  </div>
</template>
