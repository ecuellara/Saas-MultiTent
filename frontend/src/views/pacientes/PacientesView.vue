<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import PacienteFormModal from '../../components/pacientes/PacienteFormModal.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import ModalConfirmar from '../../components/ui/ModalConfirmar.vue'
import { mensajeDeError } from '../../services/errores'
import { calcularEdad, formatearFecha } from '../../services/fechas'
import {
  eliminarPaciente,
  listarPacientes,
  type Paciente,
} from '../../services/pacientes'
import { useSessionStore } from '../../stores/session'

const sesion = useSessionStore()
const router = useRouter()

const pacientes = ref<Paciente[]>([])
const cargando = ref(true)
const error = ref('')
const busqueda = ref('')

const modalForm = ref(false)
const enEdicion = ref<Paciente | null>(null)
const porEliminar = ref<Paciente | null>(null)
const eliminando = ref(false)

const puedeEscribir = computed(() => sesion.puede('patients.write'))
const puedeEliminar = computed(() => sesion.puede('patients.delete'))

/**
 * El backend no expone búsqueda ni paginación (devuelve hasta 200 por
 * `createdAt`), así que se filtra en el cliente. Cuando el número de pacientes
 * crezca, esto se mueve al servidor.
 */
const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return pacientes.value
  return pacientes.value.filter((p) =>
    [p.nombres, p.apellidos, p.numDoc ?? '', p.telefono ?? '', p.email ?? '']
      .join(' ')
      .toLowerCase()
      .includes(q),
  )
})

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    pacientes.value = await listarPacientes()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar los pacientes')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

function abrirNuevo(): void {
  enEdicion.value = null
  modalForm.value = true
}

function abrirEdicion(p: Paciente): void {
  enEdicion.value = p
  modalForm.value = true
}

async function alGuardar(): Promise<void> {
  modalForm.value = false
  enEdicion.value = null
  await cargar()
}

async function confirmarEliminar(): Promise<void> {
  if (!porEliminar.value) return
  eliminando.value = true
  error.value = ''
  try {
    await eliminarPaciente(porEliminar.value.id)
    porEliminar.value = null
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo dar de baja al paciente')
  } finally {
    eliminando.value = false
  }
}

function ver(p: Paciente): void {
  void router.push({ name: 'paciente-detalle', params: { id: p.id } })
}
</script>

<template>
  <div class="mx-auto max-w-6xl">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold text-ink">Pacientes</h2>
        <p class="mt-0.5 text-sm text-muted">
          {{ pacientes.length }} en la clínica<span v-if="busqueda"> · {{ filtrados.length }} coinciden</span>
        </p>
      </div>
      <button
        v-if="puedeEscribir"
        type="button"
        class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
        @click="abrirNuevo"
      >
        Nuevo paciente
      </button>
    </header>

    <input
      v-model="busqueda"
      type="search"
      placeholder="Buscar por nombre, documento o teléfono…"
      class="mt-4 w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary sm:max-w-sm"
    />

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando pacientes…" />

    <EstadoVacio
      v-else-if="filtrados.length === 0"
      class="mt-4"
      :titulo="busqueda ? 'Sin coincidencias' : 'Todavía no hay pacientes'"
      :detalle="
        busqueda
          ? 'Prueba con otro nombre, documento o teléfono.'
          : puedeEscribir
            ? 'Crea el primero para empezar a agendar citas.'
            : 'Pide a un administrador que registre pacientes.'
      "
    />

    <div v-else class="mt-4 overflow-x-auto rounded-lg border border-line bg-background">
      <table class="w-full text-sm">
        <thead class="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th class="px-4 py-2 font-medium">Paciente</th>
            <th class="px-4 py-2 font-medium">Documento</th>
            <th class="px-4 py-2 font-medium">Teléfono</th>
            <th class="px-4 py-2 font-medium">Edad</th>
            <th class="px-4 py-2 font-medium">Alta</th>
            <th class="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in filtrados"
            :key="p.id"
            class="border-b border-line last:border-0 hover:bg-background-soft"
          >
            <td class="px-4 py-2">
              <button
                type="button"
                class="text-left font-medium text-ink hover:text-primary"
                @click="ver(p)"
              >
                {{ p.apellidos }}, {{ p.nombres }}
              </button>
              <span
                v-if="!p.activo"
                class="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] uppercase text-warning"
              >
                Inactivo
              </span>
            </td>
            <td class="px-4 py-2 text-muted">
              <span v-if="p.numDoc">{{ p.tipoDoc }} {{ p.numDoc }}</span>
              <span v-else>—</span>
            </td>
            <td class="px-4 py-2 text-muted">{{ p.telefono ?? '—' }}</td>
            <td class="px-4 py-2 text-muted">{{ calcularEdad(p.fechaNac) ?? '—' }}</td>
            <td class="px-4 py-2 text-muted">{{ formatearFecha(p.createdAt) }}</td>
            <td class="whitespace-nowrap px-4 py-2 text-right">
              <button
                type="button"
                class="rounded px-2 py-1 text-xs text-primary hover:bg-background-soft"
                @click="ver(p)"
              >
                Ver
              </button>
              <button
                v-if="puedeEscribir"
                type="button"
                class="rounded px-2 py-1 text-xs text-primary hover:bg-background-soft"
                @click="abrirEdicion(p)"
              >
                Editar
              </button>
              <button
                v-if="puedeEliminar"
                type="button"
                class="rounded px-2 py-1 text-xs text-error hover:bg-error/10"
                @click="porEliminar = p"
              >
                Baja
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <PacienteFormModal
      v-if="modalForm"
      :paciente="enEdicion"
      @guardado="alGuardar"
      @cerrar="modalForm = false"
    />

    <ModalConfirmar
      v-if="porEliminar"
      titulo="Dar de baja al paciente"
      :mensaje="`Se dará de baja a ${porEliminar.apellidos}, ${porEliminar.nombres}. El expediente no se borra: queda con baja lógica y se puede consultar.`"
      texto-confirmar="Dar de baja"
      peligro
      :ocupado="eliminando"
      @confirmar="confirmarEliminar"
      @cancelar="porEliminar = null"
    />
  </div>
</template>
