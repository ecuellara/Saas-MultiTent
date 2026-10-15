<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import DienteSvg, { type PintadoDiente } from './DienteSvg.vue'
import {
  arcadas as filasArcadas,
  toothMeta,
} from './teeth'
import AvisoError from '../ui/AvisoError.vue'
import CargandoBloque from '../ui/CargandoBloque.vue'
import ModalConfirmar from '../ui/ModalConfirmar.vue'
import {
  agregarHallazgo,
  anularHallazgo,
  firmarOdontograma,
  listarCatalogoHallazgos,
  obtenerOdontograma,
  type HallazgoCatalogo,
  type OdontogramaDetalle,
  type OdontogramaHallazgo,
} from '../../services/odontogramas'
import { mensajeDeError } from '../../services/errores'
import { formatearFecha, formatearFechaUTC } from '../../services/fechas'
import { useSessionStore } from '../../stores/session'

/**
 * Editor gráfico del odontograma (NTS 188, numeración FDI).
 *
 * Flujo: se elige un hallazgo de la paleta, se elige la pieza en la arcada,
 * se marcan superficies (si el alcance lo pide) y se registra. La fuente de
 * verdad al pintar son los `hallazgos` del detalle (tienen traza y
 * anulación); el JSON `piezas` solo se envió al crear la versión.
 *
 * Firmado → solo lectura: se muestra el aviso y se ocultan añadir/anular.
 * El servidor lo rechaza igualmente; esto es solo la interfaz.
 */
const props = defineProps<{ odontogramaId: string }>()

const emit = defineEmits<{ actualizado: [] }>()

const sesion = useSessionStore()

const detalle = ref<OdontogramaDetalle | null>(null)
const catalogo = ref<HallazgoCatalogo[]>([])
const cargando = ref(true)
const error = ref('')
const guardando = ref(false)

const hallazgoElegido = ref('')
const dienteObjetivo = ref('')
const superficiesMarcadas = ref<string[]>([])
const material = ref('')
const porAnular = ref<OdontogramaHallazgo | null>(null)
const confirmarFirma = ref(false)
/** Dentición decidua oculta por defecto: el uso diario es la permanente. */
const verDeciduos = ref(false)

function nombrePieza(numero: string): string {
  return toothMeta(numero).nombre
}

/** Filas del gráfico en orden de lectura (definición pura en `teeth.ts`). */
const arcadas = computed(() => filasArcadas(verDeciduos.value))

/** Nombre de color del catálogo → CSS (la norma usa rojo y azul). */
const COLOR_CSS: Record<string, string> = { rojo: '#dc2626', azul: '#2563eb' }
function colorCss(nombre: string): string {
  return COLOR_CSS[nombre] ?? '#6b7280'
}

const esFirmado = computed(() => detalle.value?.estado === 'firmado')
/** La interfaz solo oculta: el permiso real lo exige el servidor. */
const puedeEscribir = computed(() => sesion.puede('patients.write'))
const editable = computed(() => puedeEscribir.value && !esFirmado.value)

const entradaPorCodigo = computed(() => new Map(catalogo.value.map((c) => [c.codigo, c])))
const entradaElegida = computed(() =>
  catalogo.value.find((c) => c.codigo === hallazgoElegido.value) ?? null,
)

const porFecha = (a: { createdAt: string }, b: { createdAt: string }): number =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0

const hallazgosActivos = computed(() =>
  [...(detalle.value?.hallazgos ?? [])].filter((h) => h.activo).sort(porFecha),
)
const hallazgosAnulados = computed(() =>
  [...(detalle.value?.hallazgos ?? [])].filter((h) => !h.activo).sort(porFecha),
)

const pintadosPorDiente = computed<Record<string, PintadoDiente[]>>(() => {
  const mapa: Record<string, PintadoDiente[]> = {}
  for (const h of hallazgosActivos.value) {
    const entrada = entradaPorCodigo.value.get(h.hallazgoCodigo)
    const alcancePieza = entrada ? entrada.alcance === 'pieza' : h.superficies.length === 0
    const lista = (mapa[h.pieza] ??= [])
    lista.push({
      superficies: [...h.superficies],
      colorCss: colorCss(entrada?.colorDefecto ?? h.color),
      abreviatura: entrada?.abreviatura ?? h.hallazgoCodigo.slice(0, 2),
      piezaCompleta: alcancePieza,
      codigo: h.hallazgoCodigo,
    })
  }
  return mapa
})

function nombreHallazgo(codigo: string): string {
  return entradaPorCodigo.value.get(codigo)?.nombre ?? codigo
}

function abreviaturaHallazgo(codigo: string): string {
  return entradaPorCodigo.value.get(codigo)?.abreviatura ?? codigo.slice(0, 2)
}

function colorHallazgo(codigo: string, alternativa: string): string {
  return colorCss(entradaPorCodigo.value.get(codigo)?.colorDefecto ?? alternativa)
}

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const [cat, det] = await Promise.all([
      listarCatalogoHallazgos(),
      obtenerOdontograma(props.odontogramaId),
    ])
    catalogo.value = cat
    detalle.value = det
    if (!cat.some((c) => c.codigo === hallazgoElegido.value)) {
      hallazgoElegido.value = cat[0]?.codigo ?? ''
    }
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar el odontograma')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

watch(
  () => props.odontogramaId,
  () => {
    reiniciarSeleccion()
    void cargar()
  },
)

function reiniciarSeleccion(): void {
  dienteObjetivo.value = ''
  superficiesMarcadas.value = []
  material.value = ''
}

function elegirHallazgo(codigo: string): void {
  hallazgoElegido.value = codigo
  // Alcance pieza → no hay superficies que ofrecer ni que enviar.
  superficiesMarcadas.value = []
}

function elegirDiente(numero: string): void {
  if (numero !== dienteObjetivo.value) {
    dienteObjetivo.value = numero
    superficiesMarcadas.value = []
  }
}

/**
 * Las marcas llegan con la pieza incluida: pulsar una zona elige el diente
 * y marca a la vez (el diente no seleccionado recibe `[]`, así que el
 * toggle parte siempre del estado correcto).
 */
function marcarDiente(numero: string, marcas: string[]): void {
  dienteObjetivo.value = numero
  superficiesMarcadas.value = marcas
}

const resumenMarcas = computed(() => {
  const entrada = entradaElegida.value
  if (!dienteObjetivo.value) return 'Elige la pieza en la arcada'
  if (entrada?.alcance === 'pieza') return `Pieza ${dienteObjetivo.value} completa`
  if (superficiesMarcadas.value.length === 0) return `Pieza ${dienteObjetivo.value} · sin superficies`
  return `Pieza ${dienteObjetivo.value} · ${superficiesMarcadas.value.join(', ')}`
})

async function agregar(): Promise<void> {
  error.value = ''
  const entrada = entradaElegida.value
  if (!entrada) {
    error.value = 'Elige un hallazgo de la paleta'
    return
  }
  if (!dienteObjetivo.value) {
    error.value = 'Elige la pieza en la arcada'
    return
  }
  if (entrada.requiereSuperficie && superficiesMarcadas.value.length === 0) {
    error.value = 'Este hallazgo exige al menos una superficie marcada'
    return
  }
  if (entrada.requiereMaterial && !material.value.trim()) {
    error.value = 'Este hallazgo exige indicar el material'
    return
  }
  guardando.value = true
  try {
    await agregarHallazgo(props.odontogramaId, {
      pieza: dienteObjetivo.value,
      hallazgoCodigo: entrada.codigo,
      // Alcance pieza → SIN superficies (el servidor las rechaza con 400).
      ...(entrada.alcance === 'superficie' ? { superficies: [...superficiesMarcadas.value] } : {}),
      ...(entrada.requiereMaterial ? { material: material.value.trim() } : {}),
    })
    reiniciarSeleccion()
    await cargar()
    emit('actualizado')
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo registrar el hallazgo')
  } finally {
    guardando.value = false
  }
}

async function confirmarAnular(): Promise<void> {
  if (!porAnular.value) return
  guardando.value = true
  try {
    await anularHallazgo(props.odontogramaId, porAnular.value.id)
    porAnular.value = null
    await cargar()
    emit('actualizado')
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo anular el hallazgo')
  } finally {
    guardando.value = false
  }
}

async function confirmarFirmar(): Promise<void> {
  guardando.value = true
  try {
    await firmarOdontograma(props.odontogramaId)
    confirmarFirma.value = false
    reiniciarSeleccion()
    await cargar()
    emit('actualizado')
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo firmar el odontograma')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <AvisoError v-if="error" :mensaje="error" />
    <CargandoBloque v-if="cargando" texto="Cargando odontograma…" />

    <template v-else-if="detalle">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-base font-semibold text-ink">
            Odontograma v{{ detalle.version }} · {{ detalle.tipo }}
          </h3>
          <p class="text-xs text-muted">
            {{ formatearFechaUTC(detalle.fecha) }}
            <span
              class="ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium"
              :class="
                esFirmado ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
              "
            >
              {{ esFirmado ? 'Firmado' : 'Borrador' }}
            </span>
          </p>
        </div>
        <button
          v-if="!esFirmado && puedeEscribir"
          type="button"
          class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
          :disabled="guardando"
          @click="confirmarFirma = true"
        >
          Firmar versión
        </button>
      </header>

      <p v-if="esFirmado" class="rounded-md border border-line bg-background-soft px-3 py-2 text-sm text-muted">
        Firmado{{ detalle.firmadoEn ? ` el ${formatearFecha(detalle.firmadoEn)}` : '' }}:
        solo lectura. Para corregir, crea una versión nueva.
      </p>

      <section aria-label="Arcadas">
        <div class="space-y-3 overflow-x-auto rounded-[28px] border border-line bg-background p-4 shadow-sm">
          <div class="min-w-max space-y-4">
            <div v-for="fila in arcadas" :key="fila.titulo">
              <p class="mb-1 text-xs font-semibold text-muted">{{ fila.titulo }}</p>
              <div class="flex items-stretch gap-1.5">
                <button
                  v-for="n in fila.a"
                  :key="n"
                  type="button"
                  :title="nombrePieza(n)"
                  class="w-[64px] shrink-0 rounded-lg border transition sm:w-[78px]"
                  :class="dienteObjetivo === n ? 'border-primary ring-2 ring-secondary/50' : 'border-transparent hover:border-secondary'"
                  @click="elegirDiente(n)"
                >
                  <DienteSvg
                    :numero="n"
                    :marcadas="dienteObjetivo === n ? superficiesMarcadas : []"
                    :pintados="pintadosPorDiente[n] ?? []"
                    :seleccionado="dienteObjetivo === n"
                    :solo-lectura="!editable"
                    @elegir="elegirDiente"
                    @update:marcadas="(m) => marcarDiente(n, m)"
                  />
                </button>
                <div class="mx-1 w-px shrink-0 self-stretch bg-line" title="Línea media" />
                <button
                  v-for="n in fila.b"
                  :key="n"
                  type="button"
                  :title="nombrePieza(n)"
                  class="w-[64px] shrink-0 rounded-lg border transition sm:w-[78px]"
                  :class="dienteObjetivo === n ? 'border-primary ring-2 ring-secondary/50' : 'border-transparent hover:border-secondary'"
                  @click="elegirDiente(n)"
                >
                  <DienteSvg
                    :numero="n"
                    :marcadas="dienteObjetivo === n ? superficiesMarcadas : []"
                    :pintados="pintadosPorDiente[n] ?? []"
                    :seleccionado="dienteObjetivo === n"
                    :solo-lectura="!editable"
                    @elegir="elegirDiente"
                    @update:marcadas="(m) => marcarDiente(n, m)"
                  />
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            class="text-xs font-semibold text-primary underline"
            @click="verDeciduos = !verDeciduos"
          >
            {{ verDeciduos ? 'Ocultar dentición decidua' : 'Mostrar dentición decidua' }}
          </button>

          <div class="flex flex-wrap items-center gap-3 border-t border-line pt-3 text-[11px] text-muted">
            <span class="inline-flex items-center gap-1">
              <span class="h-2.5 w-2.5 rounded-full bg-[#2563eb]" />
              Azul: buen estado / tratamiento en buen estado
            </span>
            <span class="inline-flex items-center gap-1">
              <span class="h-2.5 w-2.5 rounded-full bg-[#dc2626]" />
              Rojo: patológico / mal estado / temporal
            </span>
          </div>
        </div>
      </section>

      <section v-if="editable" aria-label="Registrar hallazgo" class="rounded-lg border border-line bg-background p-4">
        <h4 class="text-sm font-semibold text-ink">Registrar hallazgo</h4>
        <div class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="c in catalogo"
            :key="c.codigo"
            type="button"
            class="flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm"
            :class="
              hallazgoElegido === c.codigo
                ? 'border-primary ring-2 ring-primary'
                : 'border-line hover:bg-background-soft'
            "
            :title="`${c.nombre}${c.alcance === 'pieza' ? ' (pieza completa)' : ''}${c.requiereSuperficie ? ' · exige superficie' : ''}${c.requiereMaterial ? ' · exige material' : ''}`"
            @click="elegirHallazgo(c.codigo)"
          >
            <span
              class="inline-block h-3 w-3 rounded-full"
              :style="{ backgroundColor: colorCss(c.colorDefecto) }"
            />
            <span class="rounded bg-background-soft px-1 font-mono text-[11px] text-muted">
              {{ c.abreviatura }}
            </span>
            <span class="text-ink">{{ c.nombre }}</span>
          </button>
        </div>

        <p v-if="entradaElegida" class="mt-2 text-xs text-muted">
          {{ resumenMarcas }}
          <template v-if="entradaElegida.alcance === 'pieza'"> · pieza completa, sin superficies</template>
          <template v-else-if="entradaElegida.requiereSuperficie"> · marca al menos una superficie</template>
        </p>

        <div v-if="entradaElegida?.requiereMaterial" class="mt-3 max-w-xs">
          <label class="mb-1 block text-xs font-medium text-ink" for="od-material">
            Material (obligatorio para {{ entradaElegida.nombre.toLowerCase() }})
          </label>
          <input
            id="od-material"
            v-model="material"
            type="text"
            placeholder="p. ej. resina, amalgama, porcelana…"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        <div class="mt-3 flex gap-2">
          <button
            type="button"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
            :disabled="guardando"
            @click="agregar"
          >
            {{ guardando ? 'Registrando…' : 'Añadir hallazgo' }}
          </button>
          <button
            type="button"
            class="rounded-md border border-line px-3 py-2 text-sm text-ink hover:bg-background-soft"
            @click="reiniciarSeleccion"
          >
            Limpiar
          </button>
        </div>
      </section>

      <section aria-label="Hallazgos registrados">
        <h4 class="text-sm font-semibold text-ink">
          Hallazgos ({{ hallazgosActivos.length }})
        </h4>
        <p v-if="hallazgosActivos.length === 0" class="mt-1 text-sm text-muted">
          Esta versión aún no tiene hallazgos registrados.
        </p>
        <ul v-else class="mt-2 space-y-2">
          <li
            v-for="h in hallazgosActivos"
            :key="h.id"
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-background p-3"
          >
            <p class="flex flex-wrap items-center gap-2 text-sm">
              <span
                class="rounded px-1.5 py-0.5 font-mono text-[11px] font-bold text-white"
                :style="{ backgroundColor: colorHallazgo(h.hallazgoCodigo, h.color) }"
              >
                {{ abreviaturaHallazgo(h.hallazgoCodigo) }}
              </span>
              <span class="font-medium text-ink">Pieza {{ h.pieza }}</span>
              <span class="text-muted">{{ nombreHallazgo(h.hallazgoCodigo) }}</span>
              <span v-if="h.superficies.length > 0" class="font-mono text-xs text-muted">
                {{ h.superficies.join(', ') }}
              </span>
              <span v-if="h.material" class="text-xs text-muted"> · {{ h.material }}</span>
              <span class="text-xs text-muted"> · {{ formatearFecha(h.createdAt) }}</span>
            </p>
            <button
              v-if="editable"
              type="button"
              class="rounded-md border border-line px-2.5 py-1 text-xs text-ink hover:bg-background-soft disabled:opacity-60"
              :disabled="guardando"
              @click="porAnular = h"
            >
              Anular
            </button>
          </li>
        </ul>

        <div v-if="hallazgosAnulados.length > 0" class="mt-4">
          <h5 class="text-xs font-medium uppercase tracking-wide text-muted">
            Anulados (se conservan: anular ≠ borrar)
          </h5>
          <ul class="mt-2 space-y-2 opacity-60">
            <li
              v-for="h in hallazgosAnulados"
              :key="h.id"
              class="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line bg-background p-3 text-sm"
            >
              <span class="rounded bg-background-soft px-1.5 py-0.5 text-[11px] font-medium text-muted">
                Anulado
              </span>
              <span class="text-ink">Pieza {{ h.pieza }}</span>
              <span class="text-muted">{{ nombreHallazgo(h.hallazgoCodigo) }}</span>
            </li>
          </ul>
        </div>
      </section>
    </template>

    <ModalConfirmar
      v-if="porAnular"
      titulo="Anular hallazgo"
      :mensaje="`Se anulará «${nombreHallazgo(porAnular.hallazgoCodigo)}» en la pieza ${porAnular.pieza}. La fila se conserva en el historial (anular ≠ borrar).`"
      texto-confirmar="Anular"
      peligro
      :ocupado="guardando"
      @confirmar="confirmarAnular"
      @cancelar="porAnular = null"
    />

    <ModalConfirmar
      v-if="confirmarFirma"
      titulo="Firmar odontograma"
      mensaje="Al firmar, la versión queda en solo lectura. Para corregir después habrá que crear una versión nueva."
      texto-confirmar="Firmar"
      :ocupado="guardando"
      @confirmar="confirmarFirmar"
      @cancelar="confirmarFirma = false"
    />
  </div>
</template>
