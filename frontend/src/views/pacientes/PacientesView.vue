<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRightIcon, ClipboardDocumentListIcon, MagnifyingGlassIcon, PlusIcon } from '@heroicons/vue/24/outline'
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
  <div class="mx-auto max-w-6xl space-y-4">
    <section class="overflow-hidden rounded-[28px] border border-line bg-background shadow-sm">
      <div class="grid gap-6 px-6 py-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8 lg:py-8">
        <div class="space-y-4">
          <div class="inline-flex items-center gap-2 rounded-full border border-line bg-background-soft/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            <ClipboardDocumentListIcon class="h-4 w-4 text-secondary" />Gestión de pacientes
          </div>
          <div class="space-y-2">
            <h2 class="text-3xl font-semibold tracking-tight text-ink">Seguimiento clínico con toda la ficha en un solo lugar.</h2>
            <p class="max-w-2xl text-sm leading-6 text-muted">Busca por documento, nombre o teléfono y abre el expediente sin perder contexto.</p>
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div class="rounded-2xl border border-line bg-background-soft/60 p-4">
            <p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Pacientes totales</p>
            <p class="mt-2 text-3xl font-semibold text-ink">{{ pacientes.length }}</p>
            <p class="mt-1 text-sm text-muted">Base activa de la clínica.</p>
          </div>
          <button v-if="puedeEscribir" type="button" class="group flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-4 text-sm font-semibold text-white shadow-[0_14px_30px_-16px_rgba(7,86,163,0.8)] transition hover:-translate-y-0.5 hover:bg-primary-dark" @click="abrirNuevo">
            <PlusIcon class="h-5 w-5 transition-transform group-hover:scale-110" />Nuevo paciente
          </button>
        </div>
      </div>
    </section>

    <div class="grid gap-3 rounded-[28px] border border-line bg-background p-5 shadow-sm sm:grid-cols-[1fr_auto] sm:items-center">
      <div class="relative">
        <MagnifyingGlassIcon class="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
        <input v-model="busqueda" type="search" placeholder="DNI, nombre, teléfono…"
          class="w-full rounded-2xl border border-line bg-background-soft/60 py-3 pl-10 pr-4 text-sm text-ink transition focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-secondary/30" />
      </div>
      <p class="text-sm text-muted">{{ filtrados.length }} resultado{{ filtrados.length === 1 ? '' : 's' }}</p>
    </div>

    <AvisoError v-if="error" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando pacientes…" />

    <EstadoVacio
      v-else-if="filtrados.length === 0"
      :titulo="busqueda ? 'Sin coincidencias' : 'Todavía no hay pacientes'"
      :detalle="
        busqueda
          ? 'Prueba con otro nombre, documento o teléfono.'
          : puedeEscribir
            ? 'Crea el primero para empezar a agendar citas.'
            : 'Pide a un administrador que registre pacientes.'
      "
    />

    <div v-else class="overflow-hidden rounded-[28px] border border-line bg-background shadow-sm">
      <div class="border-b border-line px-5 py-4">
        <h3 class="text-lg font-semibold text-ink">Listado de pacientes</h3>
        <p class="text-sm text-muted">Información de contacto y acceso al expediente clínico.</p>
      </div>
      <div class="overflow-x-auto">
      <table class="w-full min-w-[760px] text-sm">
        <thead class="bg-background-soft/70 text-left text-xs uppercase tracking-wide text-muted">
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
            class="border-t border-line/70 transition first:border-0 hover:bg-background-soft/60"
          >
            <td class="px-4 py-2">
              <button
                type="button"
                class="text-left font-semibold text-ink hover:text-primary"
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
                class="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark"
                @click="ver(p)"
              >
                Abrir ficha <ArrowRightIcon class="h-3.5 w-3.5" />
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
