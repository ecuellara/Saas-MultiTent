<script setup lang="ts">
import { computed } from 'vue'

/**
 * Una pieza dental (FDI) con sus 5 superficies clicables.
 *
 * Geometría: la oclusal al centro y mesial/distal/vestibular/lingual
 * alrededor. Cada zona se marca de una en una (multi-selección): el editor
 * guarda el conjunto en `marcadas`. Lo ya registrado (`pintados`, hallazgos
 * ACTIVOS) se pinta con el color del catálogo; los anulados NO llegan aquí.
 *
 * Orientación anatómica: `invertido` pone vestibular abajo (arcada
 * inferior) y `espejo` intercambia mesial/distal (cuadrantes 1 y 4, a la
 * izquierda del gráfico). La `O` es oclusal en molares e incisal en el
 * frente; el código no cambia.
 */
export interface PintadoDiente {
  superficies: string[]
  colorCss: string
  abreviatura: string
  /** Hallazgo de pieza completa: pinta el fondo entero, no una zona. */
  piezaCompleta: boolean
}

const props = withDefaults(
  defineProps<{
    numero: string
    marcadas: string[]
    pintados: PintadoDiente[]
    seleccionado: boolean
    invertido?: boolean
    espejo?: boolean
    soloLectura?: boolean
  }>(),
  { invertido: false, espejo: false, soloLectura: false },
)

const emit = defineEmits<{
  'update:marcadas': [string[]]
  elegir: [string]
}>()

const ETIQUETAS: Record<string, string> = {
  O: 'Oclusal',
  M: 'Mesial',
  D: 'Distal',
  V: 'Vestibular',
  L: 'Lingual',
}

interface Zona {
  codigo: string
  puntos: string
}

/** Las 5 zonas como polígonos (la oclusal es el cuadrado central). */
const zonas = computed<Zona[]>(() => [
  { codigo: 'V', puntos: '15,5 49,5 41,21 23,21' },
  { codigo: props.espejo ? 'D' : 'M', puntos: '5,15 5,49 21,41 21,23' },
  { codigo: props.espejo ? 'M' : 'D', puntos: '59,15 59,49 43,41 43,23' },
  { codigo: 'L', puntos: '15,59 49,59 41,43 23,43' },
  { codigo: 'O', puntos: '23,23 41,23 41,41 23,41' },
])

/** Voltea el diente para la arcada inferior (vestibular abajo). */
const volteo = computed(() => (props.invertido ? 'translate(0 64) scale(1 -1)' : undefined))

function pintadoZona(codigo: string): PintadoDiente | undefined {
  return props.pintados.find((p) => p.piezaCompleta || p.superficies.includes(codigo))
}

function rellenoZona(codigo: string): string {
  if (!props.soloLectura && props.seleccionado && props.marcadas.includes(codigo))
    return '#f59e0b'
  return pintadoZona(codigo)?.colorCss ?? '#ffffff'
}

function rellenoFondo(): string {
  const completo = props.pintados.find((p) => p.piezaCompleta)
  return completo ? completo.colorCss : '#f8fafc'
}

const siglas = computed(() => props.pintados.map((p) => p.abreviatura).join('·'))

function elegir(): void {
  if (!props.soloLectura) emit('elegir', props.numero)
}

function pulsarZona(codigo: string): void {
  if (props.soloLectura) return
  // Solo el toggle: el editor elige la pieza al recibir las marcas. Emitir
  // `elegir` aquí además provocaría una carrera (limpiaría las marcas que
  // este mismo clic acaba de calcular).
  const tiene = props.marcadas.includes(codigo)
  emit(
    'update:marcadas',
    tiene ? props.marcadas.filter((s) => s !== codigo) : [...props.marcadas, codigo],
  )
}
</script>

<template>
  <div class="flex flex-col items-center gap-0.5">
    <svg
      viewBox="0 0 64 64"
      class="h-14 w-14 rounded-md border"
      :class="[
        seleccionado && !soloLectura ? 'border-primary ring-2 ring-primary' : 'border-line',
        soloLectura ? 'cursor-default' : 'cursor-pointer',
      ]"
      @click="elegir"
    >
      <title>Pieza {{ numero }}</title>
      <rect x="1" y="1" width="62" height="62" rx="10" :fill="rellenoFondo()" />
      <g :transform="volteo">
        <polygon
          v-for="z in zonas"
          :key="z.codigo"
          :points="z.puntos"
          :fill="rellenoZona(z.codigo)"
          stroke="#94a3b8"
          stroke-width="1.5"
          stroke-linejoin="round"
          :class="soloLectura ? '' : 'hover:stroke-ink'"
          @click.stop="pulsarZona(z.codigo)"
        >
          <title>{{ ETIQUETAS[z.codigo] ?? z.codigo }} (pieza {{ numero }})</title>
        </polygon>
      </g>
      <text
        v-if="siglas"
        x="32"
        y="37"
        text-anchor="middle"
        font-size="11"
        font-weight="bold"
        fill="#ffffff"
        stroke="rgba(0,0,0,0.45)"
        stroke-width="0.4"
        pointer-events="none"
      >
        {{ siglas }}
      </text>
    </svg>
    <button
      type="button"
      class="rounded px-1 font-mono text-[11px] leading-tight"
      :class="seleccionado ? 'bg-primary/10 font-bold text-primary' : 'text-muted hover:text-ink'"
      @click="elegir"
    >
      {{ numero }}
    </button>
  </div>
</template>
