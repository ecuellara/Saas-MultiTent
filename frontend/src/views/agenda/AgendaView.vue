<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import CitaFormModal from '../../components/citas/CitaFormModal.vue'
import CitaReprogramarModal from '../../components/citas/CitaReprogramarModal.vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import ModalConfirmar from '../../components/ui/ModalConfirmar.vue'
import FechaInput from '../../components/ui/FechaInput.vue'
import {
  listarMiembros,
  listarSedes,
  listarTratamientos,
  type Miembro,
  type Sede,
  type Tratamiento,
} from '../../services/catalogos'
import { enlaceGoogleCalendar } from '../../services/agenda-ics'
import {
  actualizarCita,
  cancelarCita,
  claseEstado,
  ESTADOS_CITA,
  etiquetaEstado,
  listarCitasRango,
  type Cita,
} from '../../services/citas'
import { obtenerConfiguracion, type Configuracion } from '../../services/configuracion'
import { mensajeDeError } from '../../services/errores'
import {
  diasSemana,
  diaSemanaCivil,
  fechaLarga,
  finMes,
  formatearFechaUTC,
  hora12,
  hoyLima,
  inicioMes,
  paraInputFecha,
  sumarDias,
} from '../../services/fechas'
import { listarPacientes, type Paciente } from '../../services/pacientes'
import { listarPlantillas, sustituirMarcadores } from '../../services/plantillas'
import { enlaceWhatsapp, normalizarTelefono } from '../../services/whatsapp'
import { useSessionStore } from '../../stores/session'
import { CalendarDaysIcon } from '@heroicons/vue/24/outline'
import ModuloHero from '../../components/ui/ModuloHero.vue'

/**
 * Agenda con vistas de día, semana y mes.
 *
 * La lista actual se conserva como vista de día. Semana y mes cargan por rango
 * (`GET /citas?desde=&hasta=`, máximo 62 días) con los mismos filtros y el
 * mismo aislamiento: nunca se trae la clínica entera.
 */
const sesion = useSessionStore()
const router = useRouter()

type VistaAgenda = 'dia' | 'semana' | 'mes'

const VISTAS: Array<{ valor: VistaAgenda; etiqueta: string }> = [
  { valor: 'dia', etiqueta: 'Día' },
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'mes', etiqueta: 'Mes' },
]

const vista = ref<VistaAgenda>('mes')
const fecha = ref(hoyLima())
const filtros = reactive({ sedeId: '', dentistaId: '', estado: '' })

const citas = ref<Cita[]>([])
const pacientes = ref<Paciente[]>([])
const tratamientos = ref<Tratamiento[]>([])
const sedes = ref<Sede[]>([])
const miembros = ref<Miembro[]>([])
const config = ref<Configuracion | null>(null)
const textosPlantilla = ref<Record<string, { texto: string; activo: boolean }>>({})
const cargando = ref(true)
const error = ref('')
const ocupada = ref('')

const modalNueva = ref(false)
const porCancelar = ref<Cita | null>(null)
const porReprogramar = ref<Cita | null>(null)
/** Confirmación en dos pasos para «Cancelar por WhatsApp» (abre el chat). */
const armado = ref('')

const puedeEscribir = computed(() => sesion.puede('appointments.write'))
const puedeCobrar = computed(() => sesion.puede('payments.write'))
/** `GET /memberships` exige `members.manage`: sin permiso no hay filtro ni nombres. */
const puedeVerEquipo = computed(() => sesion.puede('members.manage'))

const mapaPacientes = computed(() => new Map(pacientes.value.map((p) => [p.id, p])))
const mapaTratamientos = computed(() => new Map(tratamientos.value.map((t) => [t.id, t.nombre])))
const mapaSedes = computed(() => new Map(sedes.value.map((s) => [s.id, s.nombre])))
const mapaDentistas = computed(() => new Map(miembros.value.map((m) => [m.id, m.user.nombre])))

function nombrePaciente(id: string): string {
  const p = mapaPacientes.value.get(id)
  return p ? `${p.apellidos}, ${p.nombres}` : 'Paciente'
}

/** Rango que pide cada vista (el mes nunca supera 31 días: dentro del tope de 62). */
const rango = computed(() => {
  if (vista.value === 'dia') return { fecha: fecha.value }
  if (vista.value === 'semana') {
    const dias = diasSemana(fecha.value)
    return { desde: dias[0], hasta: dias[6] }
  }
  return { desde: inicioMes(fecha.value), hasta: finMes(fecha.value) }
})

const tituloVista = computed(() => {
  if (vista.value === 'dia') return fechaLarga(fecha.value)
  if (vista.value === 'semana') {
    const dias = diasSemana(fecha.value)
    return `Semana del ${formatearFechaUTC(dias[0] + 'T00:00:00.000Z')} al ${formatearFechaUTC(dias[6] + 'T00:00:00.000Z')}`
  }
  const d = new Date(`${inicioMes(fecha.value)}T00:00:00.000Z`)
  return d.toLocaleDateString('es-PE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
})

const resumen = computed(() => ({
  total: citas.value.length,
  pendientes: citas.value.filter((c) => c.estado === 'pendiente').length,
  canceladas: citas.value.filter((c) => c.estado === 'cancelada').length,
}))

/**
 * Descarta respuestas viejas: al navegar rápido entre fechas/vistas se lanzan
 * varias peticiones y la que llega última no es necesariamente la actual.
 */
let solicitudCitas = 0

async function cargarCitas(): Promise<void> {
  const actual = ++solicitudCitas
  cargando.value = true
  error.value = ''
  armado.value = ''
  try {
    const lista = await listarCitasRango({
      ...rango.value,
      ...(filtros.sedeId ? { sedeId: filtros.sedeId } : {}),
      ...(filtros.dentistaId ? { dentistaId: filtros.dentistaId } : {}),
      ...(filtros.estado ? { estado: filtros.estado } : {}),
    })
    if (actual !== solicitudCitas) return
    citas.value = lista
  } catch (e) {
    if (actual !== solicitudCitas) return
    error.value = mensajeDeError(e, 'No se pudo cargar la agenda')
  } finally {
    if (actual === solicitudCitas) cargando.value = false
  }
}

async function cargarCatalogos(): Promise<void> {
  try {
    // Pacientes y tratamientos se degradan por separado: un rol con solo
    // `appointments.read` recibe 403 en `/pacientes` y no debe quedarse sin
    // sedes, plantillas ni agenda.
    const [p, t, s, c, pl] = await Promise.all([
      listarPacientes().catch(() => [] as Paciente[]),
      listarTratamientos().catch(() => [] as Tratamiento[]),
      listarSedes().catch(() => [] as Sede[]),
      obtenerConfiguracion().catch(() => null),
      listarPlantillas().catch(() => ({ plantillas: [], marcadores: {} })),
    ])
    pacientes.value = p
    tratamientos.value = t
    sedes.value = s
    config.value = c
    textosPlantilla.value = Object.fromEntries(
      pl.plantillas.map((x) => [x.clave, { texto: x.texto, activo: x.activo }]),
    )
    if (puedeVerEquipo.value) miembros.value = await listarMiembros().catch(() => [])
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar los catálogos')
  }
}

onMounted(async () => {
  await cargarCatalogos()
  await cargarCitas()
})
watch([fecha, vista], cargarCitas)
watch(filtros, cargarCitas)

function mover(dias: number): void {
  if (vista.value === 'mes') {
    const [y, m] = fecha.value.split('-').map(Number)
    const n = new Date(Date.UTC(y, m - 1 + dias, 1))
    fecha.value = `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-01`
  } else if (vista.value === 'semana') {
    fecha.value = sumarDias(fecha.value, dias * 7)
  } else {
    fecha.value = sumarDias(fecha.value, dias)
  }
}

function irHoy(): void {
  fecha.value = hoyLima()
}

function irADia(dia: string): void {
  fecha.value = dia
  vista.value = 'dia'
}

/** Citas de un día civil (`aaaa-mm-dd`). */
function citasDelDia(dia: string): Cita[] {
  return citas.value.filter((c) => c.fecha.slice(0, 10) === dia)
}

const DIAS_CLAVE = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'] as const

/** Días sin atención según el horario configurado (se marcan en el mes). */
function diaCerrado(dia: string): boolean {
  const horario = config.value?.horario
  if (!horario) return false
  const clave = DIAS_CLAVE[diaSemanaCivil(dia)]
  return horario[clave] == null
}

const diasSemanaLista = computed(() => diasSemana(fecha.value))

const celdasMes = computed(() => {
  const primero = inicioMes(fecha.value)
  const [y, m] = primero.split('-').map(Number)
  const desplazamiento = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const diasMes = Number(finMes(fecha.value).slice(8, 10))
  const celdas: Array<{ dia: string; otroMes: boolean }> = []
  for (let i = desplazamiento - 1; i >= 0; i--) {
    celdas.push({ dia: sumarDias(primero, -(i + 1)), otroMes: true })
  }
  for (let d = 1; d <= diasMes; d++) {
    celdas.push({
      dia: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      otroMes: false,
    })
  }
  let extra = 1
  while (celdas.length < 42) {
    celdas.push({ dia: sumarDias(finMes(fecha.value), extra), otroMes: true })
    extra++
  }
  return celdas
})

async function cambiarEstado(cita: Cita, estado: Cita['estado']): Promise<void> {
  ocupada.value = cita.id
  error.value = ''
  try {
    await actualizarCita(cita.id, { estado })
    await cargarCitas()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cambiar el estado de la cita')
  } finally {
    ocupada.value = ''
  }
}

async function confirmarCancelacion(): Promise<void> {
  if (!porCancelar.value) return
  ocupada.value = porCancelar.value.id
  error.value = ''
  try {
    await cancelarCita(porCancelar.value.id)
    porCancelar.value = null
    await cargarCitas()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cancelar la cita')
  } finally {
    ocupada.value = ''
  }
}

async function alCrear(): Promise<void> {
  modalNueva.value = false
  await cargarCitas()
}

async function alAvisar(): Promise<void> {
  porReprogramar.value = null
  await cargarCitas()
}

/**
 * Enlace «Añadir a Google Calendar» de UNA cita: se construye en el cliente,
 * sin backend ni claves. La fecha civil sale del instante guardado (UTC).
 */
function enlaceCita(cita: Cita): string {
  const tratamiento = cita.tratamientoId ? (mapaTratamientos.value.get(cita.tratamientoId) ?? null) : null
  return enlaceGoogleCalendar({
    titulo: tratamiento ? `${nombrePaciente(cita.pacienteId)} — ${tratamiento}` : nombrePaciente(cita.pacienteId),
    fecha: paraInputFecha(cita.fecha),
    horaInicio: cita.horaInicio,
    horaFin: cita.horaFin,
    sede: (cita.sedeId && mapaSedes.value.get(cita.sedeId)) || null,
    detalle: `Cita ${cita.token}`,
  })
}

/* ---------------- WhatsApp manual (sin API de Meta) ---------------- */

function telefonoDe(cita: Cita): string | null {
  return normalizarTelefono(mapaPacientes.value.get(cita.pacienteId)?.telefono)
}

function motivoTelefono(cita: Cita): string {
  const tel = mapaPacientes.value.get(cita.pacienteId)?.telefono
  if (!tel) return 'El paciente no tiene teléfono registrado'
  return 'El teléfono registrado no tiene un formato válido'
}

function plantillaDe(clave: string): string | null {
  const p = textosPlantilla.value[clave]
  return p && p.activo ? p.texto : null
}

function valoresMensaje(cita: Cita, fechaIso?: string, hora?: string): Record<string, string> {
  return {
    paciente: nombrePaciente(cita.pacienteId),
    fecha: formatearFechaUTC(fechaIso ?? cita.fecha),
    hora: hora ?? cita.horaInicio,
    clinica: config.value?.nombre ?? 'la clínica',
    odontologo: (cita.dentistaId && mapaDentistas.value.get(cita.dentistaId)) || 'nuestro equipo',
    sede: (cita.sedeId && mapaSedes.value.get(cita.sedeId)) || 'nuestra sede',
  }
}

function enlaceAviso(cita: Cita, clave: string): string {
  const texto = plantillaDe(clave) ?? ''
  const mensaje = sustituirMarcadores(texto, valoresMensaje(cita))
  return enlaceWhatsapp(telefonoDe(cita) as string, mensaje)
}

/** «Confirmar por WhatsApp»: abre el chat y marca confirmada (endpoint existente). */
async function confirmarPorWhatsapp(cita: Cita): Promise<void> {
  await cambiarEstado(cita, 'confirmada')
}

/** «Cancelar por WhatsApp»: dos pasos (el primero arma, el segundo abre el chat y cancela). */
async function cancelarPorWhatsapp(cita: Cita, ev: Event): Promise<void> {
  const llave = `cancelar-${cita.id}`
  if (armado.value !== llave) {
    // Sin armar no se navega: el enlace solo existe tras confirmar.
    ev.preventDefault()
    armado.value = llave
    return
  }
  // Armado: se deja navegar al chat (target _blank) y en paralelo se cancela.
  armado.value = ''
  ocupada.value = cita.id
  error.value = ''
  try {
    await cancelarCita(cita.id)
    await cargarCitas()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cancelar la cita')
  } finally {
    ocupada.value = ''
  }
}

function puedeAvisar(cita: Cita, clave: string): boolean {
  return telefonoDe(cita) !== null && plantillaDe(clave) !== null
}

function motivoAviso(cita: Cita): string {
  if (telefonoDe(cita) === null) return motivoTelefono(cita)
  return 'Plantilla desactivada (Configuración → Notificaciones)'
}
</script>

<template>
  <div class="space-y-4">
    <ModuloHero etiqueta="Agenda clínica" :titulo="tituloVista" descripcion="Consulta la jornada, confirma pacientes y registra nuevas citas." :icono="CalendarDaysIcon" :metrica="String(resumen.total)" :metrica-etiqueta="vista === 'dia' ? 'Citas del día' : 'Citas en vista'">
      <button
        v-if="puedeEscribir"
        type="button"
        class="rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark"
        @click="modalNueva = true"
      >
        Nueva cita
      </button>
    </ModuloHero>

    <!-- Conmutador de vista -->
    <div class="flex flex-wrap items-center gap-2 rounded-[28px] border border-line bg-background p-4 shadow-sm">
      <div class="flex overflow-hidden rounded-md border border-line" role="tablist" aria-label="Vista de agenda">
        <button
          v-for="v in VISTAS"
          :key="v.valor"
          type="button"
          role="tab"
          :aria-selected="vista === v.valor"
          class="px-3 py-1.5 text-sm capitalize"
          :class="vista === v.valor ? 'bg-primary font-semibold text-white' : 'text-ink hover:bg-background-soft'"
          @click="vista = v.valor"
        >
          {{ v.etiqueta }}
        </button>
      </div>
      <button
        type="button"
        class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-background-soft"
        :aria-label="vista === 'mes' ? 'Mes anterior' : vista === 'semana' ? 'Semana anterior' : 'Día anterior'"
        @click="mover(-1)"
      >
        ←
      </button>
      <div class="w-44"><FechaInput v-model="fecha" /></div>
      <button
        type="button"
        class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-background-soft"
        :aria-label="vista === 'mes' ? 'Mes siguiente' : vista === 'semana' ? 'Semana siguiente' : 'Día siguiente'"
        @click="mover(1)"
      >
        →
      </button>
      <button
        type="button"
        class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-background-soft"
        @click="irHoy"
      >
        Hoy
      </button>
      <button
        type="button"
        class="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-background-soft"
        title="Crea un feed para ver tu agenda en el calendario del celular"
        @click="router.push({ name: 'configuracion', hash: '#calendario' })"
      >
        Suscribir mi agenda
      </button>

      <p class="ml-auto text-xs text-muted">
        {{ resumen.total }} citas · {{ resumen.pendientes }} por confirmar<span
          v-if="resumen.canceladas"
        >
          · {{ resumen.canceladas }} canceladas</span
        >
      </p>
    </div>

    <!-- Filtros (los aplica el servidor, con el mismo aislamiento) -->
    <div class="flex flex-wrap items-end gap-2 rounded-[28px] border border-line bg-background p-4 shadow-sm">
      <label class="block text-sm">
        <span class="mb-1 block text-xs font-medium text-ink">Sede</span>
        <select
          v-model="filtros.sedeId"
          class="rounded-md border border-line bg-background-soft px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todas</option>
          <option v-for="s in sedes" :key="s.id" :value="s.id">{{ s.nombre }}</option>
        </select>
      </label>
      <label v-if="puedeVerEquipo" class="block text-sm">
        <span class="mb-1 block text-xs font-medium text-ink">Odontólogo</span>
        <select
          v-model="filtros.dentistaId"
          class="rounded-md border border-line bg-background-soft px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todos</option>
          <option v-for="m in miembros" :key="m.id" :value="m.id">{{ m.user.nombre }}</option>
        </select>
      </label>
      <label class="block text-sm">
        <span class="mb-1 block text-xs font-medium text-ink">Estado</span>
        <select
          v-model="filtros.estado"
          class="rounded-md border border-line bg-background-soft px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="">Todos</option>
          <option v-for="e in ESTADOS_CITA" :key="e.valor" :value="e.valor">{{ e.etiqueta }}</option>
        </select>
      </label>
    </div>

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando agenda…" />

    <template v-else>
      <!-- Vista de día: la lista actual -->
      <div v-if="vista === 'dia'">
        <EstadoVacio
          v-if="citas.length === 0"
          class="mt-4"
          titulo="Sin citas para este día"
          :detalle="
            puedeEscribir
              ? 'Crea la primera cita con «Nueva cita».'
              : 'No tienes permiso para agendar citas.'
          "
        />

        <ul v-else class="mt-4 space-y-2">
          <li
            v-for="cita in citas"
            :key="cita.id"
            class="rounded-lg border border-line bg-background p-4"
            :class="cita.estado === 'cancelada' && 'opacity-60'"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-sm text-muted">
                    {{ hora12(cita.horaInicio) }} – {{ hora12(cita.horaFin) }}
                  </span>
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                    :class="claseEstado(cita.estado)"
                  >
                    {{ etiquetaEstado(cita.estado) }}
                  </span>
                </p>
                <p class="mt-1 truncate text-sm font-medium text-ink">
                  {{ nombrePaciente(cita.pacienteId) }}
                </p>
                <p class="mt-0.5 text-xs text-muted">
                  <span v-if="cita.tratamientoId">
                    {{ mapaTratamientos.get(cita.tratamientoId) ?? 'Tratamiento' }}
                  </span>
                  <span v-else>Sin tratamiento</span>
                  <span class="ml-2 font-mono">{{ cita.token }}</span>
                </p>
                <p v-if="cita.observacion" class="mt-1 text-xs text-muted">{{ cita.observacion }}</p>
              </div>

              <div class="flex shrink-0 flex-wrap gap-1">
                <template v-if="puedeEscribir">
                  <button
                    v-if="cita.estado === 'pendiente' || cita.estado === 'reprogramada'"
                    type="button"
                    class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft disabled:opacity-60"
                    :disabled="ocupada === cita.id"
                    @click="cambiarEstado(cita, 'confirmada')"
                  >
                    Confirmar
                  </button>
                  <button
                    v-if="['confirmada', 'recordatorio_enviado', 'reprogramada'].includes(cita.estado)"
                    type="button"
                    class="rounded border border-line px-2 py-1 text-xs text-success hover:bg-success/10 disabled:opacity-60"
                    :disabled="ocupada === cita.id"
                    @click="cambiarEstado(cita, 'realizada')"
                  >
                    Realizada
                  </button>
                  <button
                    v-if="['confirmada', 'recordatorio_enviado', 'reprogramada'].includes(cita.estado)"
                    type="button"
                    class="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-background-soft disabled:opacity-60"
                    :disabled="ocupada === cita.id"
                    @click="cambiarEstado(cita, 'no_asistio')"
                  >
                    No asistió
                  </button>
                  <button
                    v-if="puedeCobrar && cita.estado !== 'cancelada'"
                    type="button"
                    class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft disabled:opacity-60"
                    :disabled="ocupada === cita.id"
                    @click="router.push({ name: 'pagos', query: { cita: cita.id } })"
                  >
                    Cobrar
                  </button>
                  <button
                    v-if="cita.estado !== 'cancelada' && cita.estado !== 'realizada'"
                    type="button"
                    class="rounded border border-line px-2 py-1 text-xs text-error hover:bg-error/10 disabled:opacity-60"
                    :disabled="ocupada === cita.id"
                    @click="porCancelar = cita"
                  >
                    Cancelar
                  </button>
                  <button
                    v-if="cita.estado !== 'cancelada' && cita.estado !== 'realizada'"
                    type="button"
                    class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft disabled:opacity-60"
                    :disabled="ocupada === cita.id"
                    title="Cambia la fecha/hora y abre WhatsApp con el aviso"
                    @click="porReprogramar = cita"
                  >
                    Reprogramar y avisar
                  </button>
                </template>
                <!-- Sin backend ni claves (se construye en el cliente): visible con
                  solo lectura de agenda. -->
                <a
                  v-if="cita.estado !== 'cancelada'"
                  :href="enlaceCita(cita)"
                  target="_blank"
                  rel="noopener"
                  title="Añade esta cita a tu calendario personal de Google"
                  class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft"
                >
                  Añadir a Google
                </a>
                <!-- WhatsApp manual: el enlace lo compone el cliente con la plantilla.
                  Abrir el chat implica cambiar el estado de la cita, así que exige
                  el mismo permiso de escritura que el PATCH. -->
                <a
                  v-if="puedeEscribir && cita.estado === 'pendiente' && puedeAvisar(cita, 'cita_confirmacion')"
                  :href="enlaceAviso(cita, 'cita_confirmacion')"
                  target="_blank"
                  rel="noopener"
                  title="Abre WhatsApp con la confirmación y marca la cita como confirmada"
                  class="rounded border border-line px-2 py-1 text-xs text-success hover:bg-success/10"
                  @click="confirmarPorWhatsapp(cita)"
                >
                  Confirmar por WhatsApp
                </a>
                <span
                  v-else-if="cita.estado === 'pendiente' && puedeEscribir"
                  class="rounded border border-line px-2 py-1 text-xs text-muted opacity-60"
                  :title="motivoAviso(cita)"
                >
                  Confirmar por WhatsApp
                </span>
                <a
                  v-if="puedeEscribir && cita.estado !== 'cancelada' && cita.estado !== 'realizada' && puedeAvisar(cita, 'cita_cancelacion')"
                  :href="enlaceAviso(cita, 'cita_cancelacion')"
                  target="_blank"
                  rel="noopener"
                  title="Abre WhatsApp con el aviso y cancela la cita"
                  class="rounded border border-line px-2 py-1 text-xs text-error hover:bg-error/10"
                  @click="cancelarPorWhatsapp(cita, $event)"
                >
                  {{ armado === `cancelar-${cita.id}` ? 'Confirma: abrir y cancelar' : 'Cancelar por WhatsApp' }}
                </a>
              </div>
            </div>
          </li>
        </ul>
      </div>

      <!-- Vista de semana: columnas en escritorio, lista apilada en móvil -->
      <div v-else-if="vista === 'semana'" class="mt-4 grid gap-2 md:grid-cols-7">
        <section
          v-for="dia in diasSemanaLista"
          :key="dia"
          class="rounded-lg border border-line bg-background p-2"
          :class="diaCerrado(dia) && 'opacity-60'"
        >
          <button type="button" class="w-full text-left" @click="irADia(dia)">
            <p class="text-[11px] font-semibold uppercase text-muted">
              {{ new Date(`${dia}T00:00:00.000Z`).toLocaleDateString('es-PE', { weekday: 'short', timeZone: 'UTC' }) }}
            </p>
            <p class="text-lg font-semibold text-ink">
              {{ Number(dia.slice(8, 10)) }}
              <span v-if="diaCerrado(dia)" class="ml-1 align-middle text-[10px] font-normal text-muted">cerrado</span>
            </p>
          </button>
          <ul class="mt-1 space-y-1">
            <li
              v-for="cita in citasDelDia(dia)"
              :key="cita.id"
              class="truncate rounded bg-background-soft px-1.5 py-1 text-[11px] text-ink"
              :title="`${hora12(cita.horaInicio)} · ${nombrePaciente(cita.pacienteId)} · ${etiquetaEstado(cita.estado)}`"
            >
              <span class="font-mono text-muted">{{ cita.horaInicio }}</span>
              {{ nombrePaciente(cita.pacienteId) }}
            </li>
          </ul>
          <p v-if="citasDelDia(dia).length === 0" class="mt-1 text-[11px] text-muted">—</p>
        </section>
      </div>

      <!-- Vista de mes: rejilla 7×6 con carga por día; pulsar abre el día -->
      <div v-else class="mt-4 rounded-[28px] border border-line bg-background p-4 shadow-sm">
        <div class="grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-muted">
          <span v-for="d in ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']" :key="d" class="py-1">{{ d }}</span>
        </div>
        <div class="grid grid-cols-7 gap-1">
          <button
            v-for="celda in celdasMes"
            :key="celda.dia"
            type="button"
            class="min-h-12 rounded-lg border px-1 py-1 text-left align-top hover:bg-background-soft sm:min-h-16"
            :class="[
              celda.otroMes ? 'border-transparent opacity-40' : 'border-line',
              celda.dia === fecha ? 'ring-2 ring-primary' : '',
            ]"
            :title="diaCerrado(celda.dia) ? 'Día sin atención' : `${citasDelDia(celda.dia).length} citas`"
            @click="irADia(celda.dia)"
          >
            <span class="text-xs font-semibold" :class="celda.otroMes ? 'text-muted' : 'text-ink'">
              {{ Number(celda.dia.slice(8, 10)) }}
            </span>
            <span v-if="!celda.otroMes && diaCerrado(celda.dia)" class="ml-1 text-[10px] text-muted">· cerrado</span>
            <span
              v-if="!celda.otroMes && citasDelDia(celda.dia).length > 0"
              class="mt-0.5 block w-fit rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary"
            >
              {{ citasDelDia(celda.dia).length }}
            </span>
          </button>
        </div>
      </div>
    </template>

    <CitaFormModal
      v-if="modalNueva"
      :fecha-inicial="fecha"
      @creada="alCrear"
      @cerrar="modalNueva = false"
    />

    <CitaReprogramarModal
      v-if="porReprogramar"
      :cita="porReprogramar"
      :paciente="nombrePaciente(porReprogramar.pacienteId)"
      :telefono="telefonoDe(porReprogramar)"
      :plantilla="plantillaDe('cita_reprogramacion')"
      :clinica="config?.nombre ?? 'la clínica'"
      :odontologo="(porReprogramar.dentistaId && mapaDentistas.get(porReprogramar.dentistaId)) || 'nuestro equipo'"
      :sede="(porReprogramar.sedeId && mapaSedes.get(porReprogramar.sedeId)) || 'nuestra sede'"
      @avisada="alAvisar"
      @cerrar="porReprogramar = null"
    />

    <ModalConfirmar
      v-if="porCancelar"
      titulo="Cancelar la cita"
      :mensaje="`Se cancelará la cita de ${nombrePaciente(porCancelar.pacienteId)} a las ${hora12(porCancelar.horaInicio)}. La cita no se borra: queda como cancelada.`"
      texto-confirmar="Cancelar cita"
      peligro
      :ocupado="ocupada === porCancelar.id"
      @confirmar="confirmarCancelacion"
      @cancelar="porCancelar = null"
    />
  </div>
</template>
