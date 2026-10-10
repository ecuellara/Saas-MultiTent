<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import SignaturePad from 'signature_pad'

/**
 * Captura de firma manuscrita.
 *
 * Funciona con ratón, dedo y lápiz (la librería escucha eventos de puntero) y
 * el `touch-action: none` evita que la página haga scroll mientras se dibuja
 * en tablet. El canvas se dimensiona al contenedor por `devicePixelRatio`
 * para que el trazo no salga borroso en pantallas densas.
 */
const emit = defineEmits<{ aceptar: [Blob]; cerrar: [] }>()

const lienzo = ref<HTMLCanvasElement | null>(null)
const pad = ref<SignaturePad | null>(null)
const error = ref('')
const procesando = ref(false)

function dimensionar(): void {
  const canvas = lienzo.value
  if (!canvas) return
  const razon = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = Math.max(1, Math.floor(rect.width * razon))
  canvas.height = Math.max(1, Math.floor(rect.height * razon))
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.scale(razon, razon)
  pad.value?.clear()
}

function inicializar(): void {
  if (!lienzo.value || pad.value) return
  pad.value = new SignaturePad(lienzo.value, { minWidth: 1, maxWidth: 2.5, penColor: '#111827' })
  dimensionar()
}

onMounted(() => {
  inicializar()
  window.addEventListener('resize', dimensionar)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', dimensionar)
  pad.value?.off()
})

function limpiar(): void {
  error.value = ''
  pad.value?.clear()
}

function blobDesdeDataUrl(dataUrl: string): Blob {
  const [cabecera, base64] = dataUrl.split(',', 2)
  const mime = /data:(.*?);base64/.exec(cabecera ?? '')?.[1] ?? 'image/png'
  const binario = atob(base64 ?? '')
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

async function aceptar(): Promise<void> {
  error.value = ''
  if (!pad.value || pad.value.isEmpty()) {
    // Un canvas vacío también produce un PNG válido, así que hay que avisar:
    // si no, se adjunta "nada" y el error aparece recién al firmar.
    error.value = 'Dibuja la firma antes de aceptar'
    return
  }
  procesando.value = true
  try {
    emit('aceptar', blobDesdeDataUrl(pad.value.toDataURL('image/png')))
  } finally {
    procesando.value = false
  }
}
</script>

<template>
  <div class="rounded-lg border border-line bg-background p-4">
    <canvas
      ref="lienzo"
      class="h-44 w-full touch-none rounded-md border border-line bg-white"
      aria-label="Área de firma"
    />
    <p v-if="error" class="mt-2 text-xs text-error" role="alert">{{ error }}</p>
    <div class="mt-3 flex justify-end gap-2">
      <button
        type="button"
        class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
        :disabled="procesando"
        @click="limpiar"
      >
        Limpiar
      </button>
      <button
        type="button"
        class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
        :disabled="procesando"
        @click="emit('cerrar')"
      >
        Cancelar
      </button>
      <button
        type="button"
        class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
        :disabled="procesando"
        @click="aceptar"
      >
        {{ procesando ? 'Procesando…' : 'Aceptar firma' }}
      </button>
    </div>
  </div>
</template>
