<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { mensajeDeError } from '../../services/errores'
import { formatearFecha } from '../../services/fechas'
import {
  TIPOS_DOCUMENTO,
  descargarDocumento,
  etiquetaTipoDocumento,
  listarDocumentos,
  subirDocumento,
  type DocumentoPaciente,
  type TipoDocumento,
} from '../../services/pacientes'
import AvisoError from '../ui/AvisoError.vue'
import CargandoBloque from '../ui/CargandoBloque.vue'
import EstadoVacio from '../ui/EstadoVacio.vue'

const props = defineProps<{ pacienteId: string; puedeEscribir: boolean }>()

const documentos = ref<DocumentoPaciente[]>([])
const cargando = ref(true)
const error = ref('')

const archivo = ref<File | null>(null)
const tipo = ref<TipoDocumento>('RX_PERIAPICAL')
const subiendo = ref(false)
const errorSubida = ref('')
const descargando = ref('')

/** Tope del backend (`StorageService.MAX_KB`); se comprueba aquí para no enviar 20 MB en vano. */
const MAX_KB = 20 * 1024
const MIME_ACEPTADOS = 'image/png,image/jpeg,application/pdf'

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    documentos.value = await listarDocumentos(props.pacienteId)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron cargar los documentos')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

function elegirArchivo(e: Event): void {
  const input = e.target as HTMLInputElement
  archivo.value = input.files?.[0] ?? null
  errorSubida.value = ''
}

async function subir(): Promise<void> {
  errorSubida.value = ''
  if (!archivo.value) {
    errorSubida.value = 'Elige un archivo'
    return
  }
  if (archivo.value.size > MAX_KB * 1024) {
    errorSubida.value = `El archivo supera el máximo de ${MAX_KB / 1024} MB`
    return
  }
  subiendo.value = true
  try {
    await subirDocumento(props.pacienteId, archivo.value, tipo.value)
    archivo.value = null
    // Se limpia el input para poder subir el mismo archivo otra vez.
    const input = document.getElementById('archivo-documento') as HTMLInputElement | null
    if (input) input.value = ''
    await cargar()
  } catch (e) {
    // El backend rechaza por CONTENIDO (magic bytes), no por la extensión: un
    // .txt renombrado a .png cae aquí con un 400.
    errorSubida.value = mensajeDeError(e, 'No se pudo subir el documento')
  } finally {
    subiendo.value = false
  }
}

async function descargar(doc: DocumentoPaciente): Promise<void> {
  descargando.value = doc.id
  error.value = ''
  try {
    await descargarDocumento(props.pacienteId, doc.id, doc.nombreArchivo)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo descargar el documento')
  } finally {
    descargando.value = ''
  }
}

/** Tamaño legible a partir de los KB que guarda el backend. */
function peso(kb: number | null): string {
  if (!kb) return '—'
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}
</script>

<template>
  <div class="space-y-4">
    <div v-if="puedeEscribir" class="rounded-lg border border-line bg-background p-4">
      <h3 class="text-sm font-medium text-ink">Adjuntar documento</h3>
      <p class="mt-1 text-xs text-muted">
        PNG, JPEG o PDF, hasta 20 MB. El servidor comprueba el contenido real del
        archivo, así que renombrar un fichero no sirve para colarlo.
      </p>

      <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div class="flex-1">
          <label class="mb-1 block text-xs font-medium text-ink" for="archivo-documento">Archivo</label>
          <input
            id="archivo-documento"
            type="file"
            :accept="MIME_ACEPTADOS"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink file:mr-3 file:rounded file:border-0 file:bg-background file:px-2 file:py-1 file:text-xs"
            @change="elegirArchivo"
          />
        </div>
        <div class="sm:w-56">
          <label class="mb-1 block text-xs font-medium text-ink" for="tipo-documento">Tipo</label>
          <select
            id="tipo-documento"
            v-model="tipo"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option v-for="t in TIPOS_DOCUMENTO" :key="t.valor" :value="t.valor">
              {{ t.etiqueta }}
            </option>
          </select>
        </div>
        <button
          type="button"
          class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
          :disabled="subiendo"
          @click="subir"
        >
          {{ subiendo ? 'Subiendo…' : 'Subir' }}
        </button>
      </div>

      <AvisoError v-if="errorSubida" class="mt-3" :mensaje="errorSubida" />
    </div>

    <AvisoError v-if="error" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando documentos…" />

    <EstadoVacio
      v-else-if="documentos.length === 0"
      titulo="Sin documentos"
      :detalle="puedeEscribir ? 'Adjunta la primera radiografía o informe.' : undefined"
    />

    <div v-else class="overflow-x-auto rounded-lg border border-line bg-background">
      <table class="w-full text-sm">
        <thead class="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th class="px-4 py-2 font-medium">Archivo</th>
            <th class="px-4 py-2 font-medium">Tipo</th>
            <th class="px-4 py-2 font-medium">Peso</th>
            <th class="px-4 py-2 font-medium">Fecha</th>
            <th class="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="doc in documentos" :key="doc.id" class="border-b border-line last:border-0">
            <td class="max-w-xs truncate px-4 py-2 text-ink" :title="doc.nombreArchivo">
              {{ doc.nombreArchivo }}
            </td>
            <td class="px-4 py-2 text-muted">{{ etiquetaTipoDocumento(doc.tipo) }}</td>
            <td class="px-4 py-2 text-muted">{{ peso(doc.tamanioKb) }}</td>
            <td class="px-4 py-2 text-muted">{{ formatearFecha(doc.createdAt) }}</td>
            <td class="px-4 py-2 text-right">
              <button
                type="button"
                class="rounded px-2 py-1 text-xs text-primary hover:bg-background-soft disabled:opacity-60"
                :disabled="descargando === doc.id"
                @click="descargar(doc)"
              >
                {{ descargando === doc.id ? 'Descargando…' : 'Descargar' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
