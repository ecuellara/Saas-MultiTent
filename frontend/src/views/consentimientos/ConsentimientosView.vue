<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import ModalBase from '../../components/ui/ModalBase.vue'
import SelectorEntidad from '../../components/ui/SelectorEntidad.vue'
import { listarPacientes } from '../../services/pacientes'
import {
  crearConsentimiento,
  crearPlantilla,
  listarPlantillas,
  type Plantilla,
} from '../../services/consentimientos'
import { mensajeDeError } from '../../services/errores'
import { hoyLocal } from '../../services/fechas'
import { useSessionStore } from '../../stores/session'

/**
 * Pantalla de consentimientos: plantillas (lista + alta) y alta de
 * consentimientos eligiendo paciente y plantilla. El uso diario vive en la
 * ficha del paciente (`ConsentimientosPanel`).
 */
const sesion = useSessionStore()

const plantillas = ref<Plantilla[]>([])
const cargando = ref(true)
const error = ref('')
const modalPlantilla = ref(false)
const modalAlta = ref(false)
const guardando = ref(false)

const formPlantilla = ref({ clave: '', titulo: '', cuerpo: '' })
const formAlta = ref({ pacienteId: '', plantillaId: '', tratamiento: '' })
const pacientes = ref<Array<{ id: string; nombres: string; apellidos: string; tipoDoc: string; numDoc: string | null }>>([])

const puedeEscribir = computed(() => sesion.puede('consents.write'))

const opcionesPacientes = computed(() =>
  pacientes.value.map((p) => ({
    valor: p.id,
    etiqueta: `${p.apellidos}, ${p.nombres}${p.numDoc ? ` · ${p.numDoc}` : ''}`,
  })),
)

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    plantillas.value = await listarPlantillas()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar las plantillas')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

async function guardarPlantilla(): Promise<void> {
  error.value = ''
  if (!formPlantilla.value.clave.trim() || !formPlantilla.value.titulo.trim() || !formPlantilla.value.cuerpo.trim()) {
    error.value = 'Clave, título y cuerpo son obligatorios'
    return
  }
  guardando.value = true
  try {
    await crearPlantilla({
      clave: formPlantilla.value.clave.trim(),
      titulo: formPlantilla.value.titulo.trim(),
      cuerpo: formPlantilla.value.cuerpo,
    })
    formPlantilla.value = { clave: '', titulo: '', cuerpo: '' }
    modalPlantilla.value = false
    await cargar()
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo crear la plantilla')
  } finally {
    guardando.value = false
  }
}

async function abrirAlta(): Promise<void> {
  error.value = ''
  try {
    pacientes.value = await listarPacientes()
    modalAlta.value = true
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar los pacientes')
  }
}

async function guardarAlta(): Promise<void> {
  error.value = ''
  if (!formAlta.value.pacienteId || !formAlta.value.plantillaId) {
    error.value = 'Elige paciente y plantilla'
    return
  }
  const pac = pacientes.value.find((p) => p.id === formAlta.value.pacienteId)
  guardando.value = true
  try {
    await crearConsentimiento({
      pacienteId: formAlta.value.pacienteId,
      plantillaId: formAlta.value.plantillaId,
      tratamiento: formAlta.value.tratamiento.trim() || undefined,
      datosSnapshot: pac
        ? {
            nombre: `${pac.nombres} ${pac.apellidos}`.trim(),
            tipoDoc: pac.tipoDoc,
            numDoc: pac.numDoc,
            fecha: hoyLocal(),
          }
        : { fecha: hoyLocal() },
    })
    formAlta.value = { pacienteId: '', plantillaId: '', tratamiento: '' }
    modalAlta.value = false
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo crear el consentimiento')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-ink">Consentimientos</h2>
      <div v-if="puedeEscribir" class="flex gap-2">
        <button
          type="button"
          class="rounded-md border border-line px-3 py-2 text-sm text-ink hover:bg-background-soft"
          @click="abrirAlta"
        >
          Nuevo consentimiento
        </button>
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          @click="modalPlantilla = true"
        >
          Nueva plantilla
        </button>
      </div>
    </header>

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando plantillas…" />

    <EstadoVacio
      v-else-if="plantillas.length === 0"
      class="mt-4"
      titulo="Sin plantillas"
      detalle="Crea la primera con «Nueva plantilla»."
    />

    <ul v-else class="mt-4 space-y-2">
      <li
        v-for="p in plantillas"
        :key="p.id"
        class="rounded-lg border border-line bg-background p-4"
      >
        <p class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium text-ink">{{ p.titulo }}</span>
          <span class="rounded bg-background-soft px-1.5 py-0.5 font-mono text-[10px] text-muted">
            {{ p.clave }}
          </span>
        </p>
        <p class="mt-1 line-clamp-2 text-xs text-muted">{{ p.cuerpo.slice(0, 160) }}</p>
      </li>
    </ul>

    <ModalBase
      v-if="modalPlantilla"
      titulo="Nueva plantilla"
      ancho="lg"
      @cerrar="modalPlantilla = false"
    >
      <form class="grid gap-3" @submit.prevent="guardarPlantilla">
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs font-medium text-ink" for="pl-clave">Clave</label>
            <input
              id="pl-clave"
              v-model="formPlantilla.clave"
              type="text"
              placeholder="endodoncia"
              class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink" for="pl-titulo">Título</label>
            <input
              id="pl-titulo"
              v-model="formPlantilla.titulo"
              type="text"
              class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="pl-cuerpo">Texto (admite {'{'}paciente{'}'}, {'{'}dni{'}'}, {'{'}fecha{'}'}…)</label>
          <textarea
            id="pl-cuerpo"
            v-model="formPlantilla.cuerpo"
            rows="8"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
            :disabled="guardando"
            @click="modalPlantilla = false"
          >
            Cancelar
          </button>
          <button
            type="submit"
            class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
            :disabled="guardando"
          >
            {{ guardando ? 'Guardando…' : 'Crear plantilla' }}
          </button>
        </div>
      </form>
    </ModalBase>

    <ModalBase
      v-if="modalAlta"
      titulo="Nuevo consentimiento"
      ancho="lg"
      @cerrar="modalAlta = false"
    >
      <form class="grid gap-3" @submit.prevent="guardarAlta">
        <div>
          <label class="mb-1 block text-xs font-medium text-ink">Paciente</label>
          <SelectorEntidad
            v-model:modelo="formAlta.pacienteId"
            :opciones="opcionesPacientes"
            placeholder="Buscar por nombre o documento…"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink">Plantilla</label>
          <SelectorEntidad
            v-model:modelo="formAlta.plantillaId"
            :opciones="plantillas.map((p) => ({ valor: p.id, etiqueta: p.titulo }))"
            placeholder="Buscar plantilla…"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="alta-trat">Tratamiento (opcional)</label>
          <input
            id="alta-trat"
            v-model="formAlta.tratamiento"
            type="text"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
            :disabled="guardando"
            @click="modalAlta = false"
          >
            Cancelar
          </button>
          <button
            type="submit"
            class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
            :disabled="guardando"
          >
            {{ guardando ? 'Creando…' : 'Crear en borrador' }}
          </button>
        </div>
      </form>
    </ModalBase>
  </div>
</template>
