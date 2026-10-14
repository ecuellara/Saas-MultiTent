<script setup lang="ts">
import { computed } from 'vue'
import { toothMeta } from './teeth'

/**
 * Pieza dental FDI con SVG anatómico (corona + raíces) y 5 zonas clicables.
 *
 * Portado del odontograma de referencia (NTS 188). A diferencia del esquema
 * cuadrado anterior, respeta:
 *  - corona y raíces según el tipo de pieza (incisivo/canino/premolar/molar);
 *  - recuadro de nomenclatura (abreviaturas);
 *  - la superficie oclusal es `O` en posteriores e incisal `I` en anteriores;
 *  - la cara palatina es `P` en la arcada superior y lingual `L` en la inferior;
 *  - mesial/distal se etiquetan según el cuadrante (`toothMeta`).
 *
 * Lo ya registrado (`pintados`, hallazgos ACTIVOS) se pinta con el color del
 * catálogo; los anulados NO llegan aquí.
 */
export interface PintadoDiente {
  superficies: string[]
  colorCss: string
  abreviatura: string
  /** Hallazgo de pieza completa: tinta la corona entera y dibuja su símbolo. */
  piezaCompleta: boolean
  /** Código del hallazgo: decide el símbolo de los hallazgos de pieza. */
  codigo: string
}

const props = withDefaults(
  defineProps<{
    numero: string
    marcadas?: string[]
    pintados?: PintadoDiente[]
    seleccionado?: boolean
    soloLectura?: boolean
  }>(),
  { marcadas: () => [], pintados: () => [], seleccionado: false, soloLectura: false },
)

const emit = defineEmits<{
  'update:marcadas': [string[]]
  elegir: [string]
}>()

const meta = computed(() => toothMeta(props.numero))
const oCode = computed(() => (meta.value.posterior ? 'O' : 'I'))
const lingualCode = computed(() => (meta.value.superior ? 'P' : 'L'))
const leftCode = computed(() => (meta.value.mesialRight ? 'D' : 'M'))
const rightCode = computed(() => (meta.value.mesialRight ? 'M' : 'D'))

const AMBAR = '#f59e0b'
const ROJO = '#dc2626'

const crownPath = computed(() => {
  switch (meta.value.tipo) {
    case 'incisivo':
      return 'M28 26 Q50 16 72 26 L69 66 Q50 78 31 66 Z'
    case 'canino':
      return 'M28 28 Q50 16 72 28 L62 58 L50 76 L38 58 Z'
    case 'premolar':
      return 'M26 30 Q34 18 50 26 Q66 18 74 30 L70 68 Q50 80 30 68 Z'
    default:
      return 'M24 30 Q50 18 76 30 L72 66 Q50 80 28 66 Z'
  }
})

const isMolar = computed(() => meta.value.tipo === 'molar')
const rootLong = computed(() => meta.value.tipo === 'canino')

interface Zona {
  code: string
  puntos: string
  etiqueta: { x: number; y: number }
}

const zonas = computed<Zona[]>(() => [
  { code: 'V', puntos: '30,28 70,28 63,48 37,48', etiqueta: { x: 50, y: 40 } },
  { code: lingualCode.value, puntos: '30,68 70,68 63,48 37,48', etiqueta: { x: 50, y: 60 } },
  { code: leftCode.value, puntos: '30,28 37,48 30,68', etiqueta: { x: 33, y: 51 } },
  { code: rightCode.value, puntos: '70,28 63,48 70,68', etiqueta: { x: 67, y: 51 } },
  { code: oCode.value, puntos: '37,48 50,35 63,48 50,61', etiqueta: { x: 50, y: 52 } },
])

function pintadoZona(code: string): PintadoDiente | undefined {
  return props.pintados.find((p) => p.superficies.includes(code))
}

function rellenoZona(code: string): string {
  if (!props.soloLectura && props.marcadas.includes(code)) return AMBAR
  return pintadoZona(code)?.colorCss ?? 'transparent'
}

function opacidadZona(code: string): number {
  if (!props.soloLectura && props.marcadas.includes(code)) return 0.55
  return pintadoZona(code) ? 0.45 : 0
}

const pieza = computed(() => props.pintados.filter((p) => p.piezaCompleta))
const piezaColor = computed(() => {
  const rojo = pieza.value.find((p) => p.colorCss.toLowerCase() === ROJO)
  return (rojo ?? pieza.value[0])?.colorCss ?? null
})
const codigos = computed(() => pieza.value.map((p) => p.codigo))

const abreviatura = computed(() => {
  const partes = props.pintados.map((p) =>
    p.superficies.length ? `${p.abreviatura} ${p.superficies.join('')}` : p.abreviatura,
  )
  return [...new Set(partes)].join(' ')
})

function elegir(): void {
  if (!props.soloLectura) emit('elegir', props.numero)
}

function pulsarZona(code: string): void {
  if (props.soloLectura) return
  // Solo el toggle: el editor elige la pieza al recibir las marcas. Emitir
  // `elegir` aquí además provocaría una carrera (limpiaría las marcas que
  // este mismo clic acaba de calcular).
  const tiene = props.marcadas.includes(code)
  emit(
    'update:marcadas',
    tiene ? props.marcadas.filter((s) => s !== code) : [...props.marcadas, code],
  )
}
</script>

<template>
  <div class="flex w-full flex-col items-center gap-0.5">
    <svg
      viewBox="0 0 100 152"
      class="h-auto w-full rounded-md border"
      :class="[
        seleccionado && !soloLectura ? 'border-primary ring-2 ring-primary' : 'border-line',
        soloLectura ? 'cursor-default' : 'cursor-pointer',
      ]"
      @click="elegir"
    >
      <title>{{ numero }} · {{ meta.nombre }}</title>

      <!-- recuadro de nomenclatura -->
      <text x="50" y="13" text-anchor="middle" font-size="11" font-weight="bold" fill="#172b3a">
        {{ abreviatura }}
      </text>

      <!-- corona -->
      <path :d="crownPath" fill="#ffffff" stroke="#172b3a" stroke-width="1.5" />
      <!-- tinte de hallazgo de pieza completa -->
      <path v-if="piezaColor" :d="crownPath" :fill="piezaColor" opacity="0.18" />

      <!-- raíces -->
      <template v-if="isMolar">
        <path d="M34 72 L30 122 Q38 129 44 122 L46 74 Z" fill="#ffffff" stroke="#172b3a" stroke-width="1.5" />
        <path d="M66 72 L70 122 Q62 129 56 122 L54 74 Z" fill="#ffffff" stroke="#172b3a" stroke-width="1.5" />
        <line x1="38" y1="80" x2="36" y2="118" stroke="#94a3b8" stroke-width="1" />
        <line x1="62" y1="80" x2="64" y2="118" stroke="#94a3b8" stroke-width="1" />
      </template>
      <template v-else>
        <path :d="`M42 72 L38 ${rootLong ? 130 : 124} Q50 ${rootLong ? 138 : 132} 62 ${rootLong ? 130 : 124} L58 72 Z`" fill="#ffffff" stroke="#172b3a" stroke-width="1.5" />
        <line x1="50" y1="78" :x2="50" :y2="rootLong ? 126 : 120" stroke="#94a3b8" stroke-width="1" />
      </template>

      <!-- símbolos de hallazgos de pieza completa -->
      <g v-if="codigos.includes('AUSENTE')" stroke="#64748b" stroke-width="2.5">
        <line x1="18" y1="14" x2="82" y2="138" />
        <line x1="82" y1="14" x2="18" y2="138" />
      </g>
      <g v-if="codigos.includes('EXTRACCION_INDICADA')" :stroke="ROJO" stroke-width="2.5">
        <line x1="18" y1="14" x2="82" y2="138" />
        <line x1="82" y1="14" x2="18" y2="138" />
      </g>
      <rect
        v-if="codigos.includes('CORONA')"
        x="20" y="18" width="60" height="64" rx="6" fill="none"
        stroke="#0756a3" stroke-width="3"
      />
      <line
        v-if="codigos.includes('ENDODONCIA')"
        x1="50" y1="30" x2="50" y2="126" stroke="#0756a3" stroke-width="3"
      />
      <rect
        v-if="codigos.includes('IMPLANTE')"
        x="45" y="76" width="10" height="52" fill="#94a3b8" stroke="#475569" stroke-width="1"
      />

      <!-- zonas de superficie clicables -->
      <g v-for="z in zonas" :key="z.code">
        <polygon
          :points="z.puntos"
          :fill="rellenoZona(z.code)"
          :opacity="opacidadZona(z.code)"
          :stroke="soloLectura ? 'none' : '#94a3b8'"
          stroke-width="1"
          stroke-linejoin="round"
          :style="soloLectura ? '' : 'cursor:pointer'"
          @click.stop="pulsarZona(z.code)"
        >
          <title>{{ z.code }} (pieza {{ numero }})</title>
        </polygon>
        <text :x="z.etiqueta.x" :y="z.etiqueta.y" text-anchor="middle" font-size="9" fill="#64748b" pointer-events="none">
          {{ z.code }}
        </text>
      </g>

      <!-- número FDI -->
      <text x="50" y="147" text-anchor="middle" font-size="13" font-weight="600" fill="#334155" pointer-events="none">{{ numero }}</text>
    </svg>
  </div>
</template>
