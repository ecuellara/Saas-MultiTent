<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import FirmaCanvas from '../consentimientos/FirmaCanvas.vue'
import ModalBase from '../ui/ModalBase.vue'
import ModalConfirmar from '../ui/ModalConfirmar.vue'
import AvisoError from '../ui/AvisoError.vue'
import CargandoBloque from '../ui/CargandoBloque.vue'
import EstadoVacio from '../ui/EstadoVacio.vue'
import { obtenerPaciente } from '../../services/pacientes'
import {
  cambiarEstadoConsentimiento,
  claseEstadoConsentimiento,
  crearConsentimiento,
  etiquetaEstadoConsentimiento,
  listarPlantillas,
  listarPorPaciente,
  subirFirma,
  type ConsentimientoListado,
  type EstadoConsentimiento,
  type Plantilla,
} from '../../services/consentimientos'
import { mensajeDeError } from '../../services/errores'
import { hoyLocal } from '../../services/fechas'
import { useSessionStore } from '../../stores/session'

const props = defineProps<{ pacienteId: string; puedeEscribir: boolean }>()

const sesion = useSessionStore()
const router = useRouter()

const lista = ref<ConsentimientoListado[]>([])
const plantillas = ref<Plantilla[]>([])
const cargando = ref(true)
const error = ref('')
const plantillaElegida = ref('')
const capturando = ref<ConsentimientoListado | null>(null)
const subiendo = ref(false)
const porCambiar = ref<{ id: string; a: EstadoConsentimiento; titulo: string } | null>(null)
const ocupado = ref(false)

const puedeFirmar = computed(() => props.puedeEscribir && sesion.puede('consents.write'))

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const [l, p] = await Promise.all([listarPorPaciente(props.pacienteId), listarPlantillas()])
    lista.value = l
    plantillas.value = p.filter((x) => x.activo !== false)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar los consentimientos')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

/**
 * `datosSnapshot` se congela AQUÍ, con los datos del paciente EN ESE MOMENTO
 * (nombre, documento y fecha): es la razón de existir del campo y no se
 * recalcula después (el backend lo congela tal cual en `cuerpoSnapshot`).
 */
async function crear(): Promise<void> {
  error.value = ''
  if (!plantillaElegida.value) {
    error.value = 'Elige una plantilla'
    return
  }
  try {
    const pac = await obtenerPaciente(props.pacienteId)
    await crearConsentimiento({
      pacienteId: props.pacienteId,
      plantillaId: plantillaElegida.value,
      datosSnapshot: {
        nombre: `${pac.nombres} ${pac.apellidos}`.trim(),
        tipoDoc: pac.tipoDoc,
        numDoc: pac.numDoc,
        fecha: hoyLocal(),
      },
    })
    plantillaElegida.value = ''
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo crear el consentimiento')
  }
}

/**
 * Firmar es en dos pasos porque el backend EXIGE la firma del paciente antes
 * del estado `firmado`: primero se adjunta la imagen y recién entonces se
 * cambia el estado. Si la subida falla, no se intenta el cambio.
 */
async function aceptarFirma(imagen: Blob): Promise<void> {
  const c = capturando.value
  if (!c) return
  subiendo.value = true
  error.value = ''
  try {
    await subirFirma(c.id, 'paciente', imagen)
    await cambiarEstadoConsentimiento(c.id, 'firmado')
    capturando.value = null
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo firmar')
  } finally {
    subiendo.value = false
  }
}

async function confirmarCambio(): Promise<void> {
  if (!porCambiar.value) return
  ocupado.value = true
  error.value = ''
  try {
    await cambiarEstadoConsentimiento(porCambiar.value.id, porCambiar.value.a)
    porCambiar.value = null
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cambiar el estado')
  } finally {
    ocupado.value = false
  }
}

function pedir(id: string, a: EstadoConsentimiento, titulo: string): void {
  porCambiar.value = { id, a, titulo }
}

function imprimir(id: string): void {
  void router.push({ name: 'consentimiento-impresion', params: { id } })
}
</script>

<template>
  <div>
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando consentimientos…" />

    <template v-else>
      <div v-if="puedeFirmar" class="mb-4 flex flex-wrap items-end gap-2">
        <div class="min-w-0 flex-1">
          <label class="mb-1 block text-xs font-medium text-ink" for="nueva-plantilla">Nuevo desde plantilla</label>
          <select
            id="nueva-plantilla"
            v-model="plantillaElegida"
            class="w-full rounded-md border border-line bg-background px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Elegir plantilla…</option>
            <option v-for="p in plantillas" :key="p.id" :value="p.id">{{ p.titulo }}</option>
          </select>
        </div>
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark"
          @click="crear"
        >
          Crear
        </button>
      </div>

      <EstadoVacio
        v-if="lista.length === 0"
        titulo="Sin consentimientos"
        detalle="Crea el primero desde una plantilla."
      />

      <ul v-else class="space-y-2">
        <li
          v-for="c in lista"
          :key="c.id"
          class="rounded-lg border border-line bg-background p-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="flex flex-wrap items-center gap-2">
                <span class="truncate text-sm font-medium text-ink">
                  {{ c.plantilla?.titulo ?? 'Consentimiento' }}
                </span>
                <span
                  class="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase"
                  :class="claseEstadoConsentimiento(c.estado)"
                >
                  {{ etiquetaEstadoConsentimiento(c.estado) }}
                </span>
              </p>
              <p class="mt-0.5 text-xs text-muted">
                {{ c.tratamiento ?? 'Sin tratamiento' }}
                <span v-if="c.firmadoEn"> · firmado {{ c.firmadoEn }}</span>
                <span v-if="c.revocadoEn"> · revocado {{ c.revocadoEn }}</span>
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap gap-1">
              <button
                type="button"
                class="rounded border border-line px-2 py-1 text-xs text-ink hover:bg-background-soft"
                @click="imprimir(c.id)"
              >
                Imprimir
              </button>
              <template v-if="puedeFirmar && c.estado === 'borrador'">
                <button
                  type="button"
                  class="rounded border border-line px-2 py-1 text-xs text-success hover:bg-success/10"
                  @click="capturando = c"
                >
                  Firmar
                </button>
                <button
                  type="button"
                  class="rounded border border-line px-2 py-1 text-xs text-error hover:bg-error/10"
                  @click="pedir(c.id, 'anulado', c.plantilla?.titulo ?? 'Consentimiento')"
                >
                  Anular
                </button>
              </template>
              <button
                v-if="puedeFirmar && c.estado === 'firmado'"
                type="button"
                class="rounded border border-line px-2 py-1 text-xs text-error hover:bg-error/10"
                @click="pedir(c.id, 'revocado', c.plantilla?.titulo ?? 'Consentimiento')"
              >
                Revocar
              </button>
            </div>
          </div>
        </li>
      </ul>
    </template>

    <ModalBase
      v-if="capturando"
      titulo="Firma del paciente"
      ancho="lg"
      @cerrar="capturando = null"
    >
      <p class="mb-3 text-xs text-muted">
        Dibuja con el dedo, el lápiz o el ratón. Sin firma no se puede marcar como firmado.
      </p>
      <FirmaCanvas @aceptar="aceptarFirma" @cerrar="capturando = null" />
      <CargandoBloque v-if="subiendo" texto="Adjuntando firma…" />
    </ModalBase>

    <ModalConfirmar
      v-if="porCambiar"
      :titulo="porCambiar.a === 'revocado' ? 'Revocar consentimiento' : 'Anular consentimiento'"
      :mensaje="`Se cambiará «${porCambiar.titulo}» a ${porCambiar.a}.`"
      :texto-confirmar="porCambiar.a === 'revocado' ? 'Revocar' : 'Anular'"
      peligro
      :ocupado="ocupado"
      @confirmar="confirmarCambio"
      @cancelar="porCambiar = null"
    />
  </div>
</template>
