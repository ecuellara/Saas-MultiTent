<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import {
  descargarFirma,
  etiquetaEstadoConsentimiento,
  obtenerConsentimiento,
  type Consentimiento,
} from '../../services/consentimientos'
import { mensajeDeError, esNoEncontrado } from '../../services/errores'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'

/**
 * Vista imprimible del consentimiento: título, `cuerpoSnapshot` CONGELADO,
 * datos del paciente del snapshot, fecha y firmas. Se imprime con el
 * navegador (`window.print`); a propósito sin librerías de PDF (`pdfKey`
 * queda sin uso: deuda registrada).
 *
 * El cuerpo se muestra tal cual se congeló, sin interpolar `{{...}}`: las
 * claves del snapshot son libres y adivinarlas rompería el documento.
 */
const route = useRoute()
const router = useRouter()
const id = String(route.params.id ?? '')

const doc = ref<Consentimiento | null>(null)
const firmaPaciente = ref('')
const firmaOdontologo = ref('')
const cargando = ref(true)
const error = ref('')
const noExiste = ref(false)
const urls: string[] = []

async function blobAUrl(idDoc: string, rol: 'paciente' | 'odontologo'): Promise<string> {
  try {
    const blob = await descargarFirma(idDoc, rol)
    const url = URL.createObjectURL(blob)
    urls.push(url)
    return url
  } catch {
    // Sin firma de ese rol: el documento igual se imprime.
    return ''
  }
}

async function cargar(): Promise<void> {
  cargando.value = true
  try {
    const c = await obtenerConsentimiento(id)
    doc.value = c
    const [p, o] = await Promise.all([blobAUrl(id, 'paciente'), blobAUrl(id, 'odontologo')])
    firmaPaciente.value = p
    firmaOdontologo.value = o
  } catch (e) {
    if (esNoEncontrado(e)) noExiste.value = true
    else error.value = mensajeDeError(e, 'No se pudo cargar el consentimiento')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)
onUnmounted(() => {
  for (const u of urls) URL.revokeObjectURL(u)
})

function imprimir(): void {
  window.print()
}

function dato(clave: string): string {
  const v = (doc.value?.datosSnapshot as Record<string, unknown> | undefined)?.[clave]
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '—'
}
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <div class="mb-3 flex gap-2 no-imprimir">
      <button class="text-xs text-muted hover:text-ink" @click="router.back()">← Volver</button>
      <button
        v-if="doc"
        class="ml-auto rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark"
        @click="imprimir"
      >
        Imprimir
      </button>
    </div>

    <CargandoBloque v-if="cargando" texto="Cargando consentimiento…" />
    <AvisoError v-else-if="error" :mensaje="error" />
    <EstadoVacio
      v-else-if="noExiste || !doc"
      titulo="Consentimiento no encontrado"
      detalle="Puede que sea de otra clínica o que ya no exista."
    />

    <article v-else id="impresion-consentimiento" class="rounded-lg border border-line bg-background p-6">
      <h1 class="text-center text-lg font-semibold text-ink">
        {{ doc.plantilla?.titulo ?? 'Consentimiento informado' }}
      </h1>

      <dl class="mt-4 grid gap-1 text-sm sm:grid-cols-2">
        <div><dt class="inline text-muted">Paciente: </dt><dd class="inline text-ink">{{ dato('nombre') }}</dd></div>
        <div><dt class="inline text-muted">Documento: </dt><dd class="inline text-ink">{{ dato('tipoDoc') }} {{ dato('numDoc') }}</dd></div>
        <div><dt class="inline text-muted">Fecha: </dt><dd class="inline text-ink">{{ dato('fecha') }}</dd></div>
        <div><dt class="inline text-muted">Estado: </dt><dd class="inline text-ink">{{ etiquetaEstadoConsentimiento(doc.estado) }}</dd></div>
      </dl>

      <p class="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">{{ doc.cuerpoSnapshot }}</p>

      <div class="mt-8 grid gap-6 sm:grid-cols-2">
        <div class="text-center">
          <div class="flex h-28 items-end justify-center border-b border-ink">
            <img v-if="firmaPaciente" :src="firmaPaciente" alt="Firma del paciente" class="max-h-28 object-contain" />
          </div>
          <p class="mt-1 text-xs text-muted">Firma del paciente</p>
        </div>
        <div class="text-center">
          <div class="flex h-28 items-end justify-center border-b border-ink">
            <img v-if="firmaOdontologo" :src="firmaOdontologo" alt="Firma del odontólogo" class="max-h-28 object-contain" />
          </div>
          <p class="mt-1 text-xs text-muted">Firma del odontólogo</p>
        </div>
      </div>

      <p class="mt-6 text-center text-[10px] text-muted">
        Documento generado por el sistema el {{ dato('fecha') }}. Texto congelado al momento de la creación.
      </p>
    </article>
  </div>
</template>

<style>
@media print {
  body * {
    visibility: hidden;
  }
  #impresion-consentimiento,
  #impresion-consentimiento * {
    visibility: visible;
  }
  #impresion-consentimiento {
    position: absolute;
    inset: 0;
    border: none;
  }
  .no-imprimir {
    display: none;
  }
}
</style>
