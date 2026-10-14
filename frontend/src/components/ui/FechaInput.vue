<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { CalendarDaysIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/vue/24/outline'
import { hoyLima } from '../../services/fechas'
import { diaFueraDeRango, fechaCalendario, mesFueraDeRango, siguienteNivel, type NivelCalendario } from '../../services/calendario'

const props = withDefaults(
  defineProps<{ modelValue?: string | null; max?: string; min?: string; id?: string; disabled?: boolean; ariaLabel?: string }>(),
  { modelValue: '', max: '2100-12-31', min: '1900-01-01', id: 'fecha', disabled: false, ariaLabel: 'Seleccionar fecha' },
)
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const valor = computed(() => props.modelValue ?? '')
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']

function partes(fecha: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(fecha)) return null
  const [y, m, d] = fecha.slice(0, 10).split('-').map(Number)
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}
const fmt = fechaCalendario
const maxDia = computed(() => props.max)
const abierto = ref(false)
const vista = ref({ y: 2000, m: 1 })
const nivel = ref<NivelCalendario>('anios')
const raiz = ref<HTMLElement | null>(null)
const panel = ref({ top: 0, left: 0, width: 288 })

function actualizarPosicion(): void {
  if (!raiz.value) return
  const r = raiz.value.getBoundingClientRect()
  const alto = 334
  // El selector puede vivir dentro de campos estrechos (p. ej. la barra de
  // Agenda), pero su grilla necesita un ancho propio para no superponer meses.
  const ancho = Math.min(320, Math.max(240, window.innerWidth - 16))
  const arriba = r.top - alto - 6
  const top = r.bottom + 6 + alto > window.innerHeight && arriba > 8 ? arriba : r.bottom + 6
  panel.value = {
    top: Math.max(8, top),
    left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)),
    width: ancho,
  }
}
function abrir(): void {
  const p = partes(valor.value) ?? partes(maxDia.value)!
  vista.value = { y: p.y, m: p.m }
  nivel.value = 'anios'
  abierto.value = true
  void nextTick(actualizarPosicion)
}
const textoBoton = computed(() => {
  const p = partes(valor.value)
  return p ? `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}` : 'dd/mm/aaaa'
})
const tituloMes = computed(() => `${MESES[vista.value.m - 1]} de ${vista.value.y}`)
const decadaBase = computed(() => Math.floor(vista.value.y / 10) * 10)
const anios = computed(() => Array.from({ length: 12 }, (_, i) => decadaBase.value - 1 + i))
function deshabilitado(y: number, m: number, d: number): boolean {
  const fecha = fmt(y, m, d)
  return diaFueraDeRango(fecha, props.min, maxDia.value)
}
function elegir(y: number, m: number, d: number): void {
  if (deshabilitado(y, m, d)) return
  emit('update:modelValue', fmt(y, m, d)); abierto.value = false
}
function elegirAnio(y: number): void {
  if (y < Number(props.min.slice(0, 4)) || y > Number(maxDia.value.slice(0, 4))) return
  vista.value.y = y
  nivel.value = siguienteNivel('anios')
}
function mesDeshabilitado(m: number): boolean {
  return mesFueraDeRango(vista.value.y, m, props.min, maxDia.value)
}
function elegirMes(m: number): void {
  if (mesDeshabilitado(m)) return
  vista.value.m = m
  nivel.value = siguienteNivel('meses')
}
function moverMes(dir: number): void {
  let { y, m } = vista.value; m += dir
  if (m < 1) { m = 12; y-- }
  if (m > 12) { m = 1; y++ }
  vista.value = { y, m }
}
function irHoy(): void { const h = partes(hoyLima()); if (h && !deshabilitado(h.y, h.m, h.d)) elegir(h.y, h.m, h.d) }
const celdas = computed(() => {
  const { y, m } = vista.value
  const offset = (new Date(y, m - 1, 1).getDay() + 6) % 7
  const diasMes = new Date(y, m, 0).getDate()
  const diasPrev = new Date(y, m - 1, 0).getDate()
  const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }
  const arr: Array<{ y: number; m: number; d: number; otro: boolean }> = []
  for (let i = offset - 1; i >= 0; i--) arr.push({ ...prev, d: diasPrev - i, otro: true })
  for (let d = 1; d <= diasMes; d++) arr.push({ y, m, d, otro: false })
  for (let d = 1; arr.length < 42; d++) arr.push({ ...next, d, otro: true })
  return arr
})
function viewport(): void { if (abierto.value) actualizarPosicion() }
window.addEventListener('resize', viewport)
window.addEventListener('scroll', viewport, true)
onBeforeUnmount(() => { window.removeEventListener('resize', viewport); window.removeEventListener('scroll', viewport, true) })
</script>

<template>
  <div ref="raiz" class="relative">
    <button :id="id" type="button" :disabled="disabled" :aria-label="ariaLabel" class="flex w-full items-center justify-between rounded-xl border border-line bg-background-soft/60 px-3 py-2.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50" @click="abrir">
      <span :class="valor ? 'text-ink' : 'text-muted'">{{ textoBoton }}</span>
      <CalendarDaysIcon class="h-5 w-5 text-muted" />
    </button>
    <Teleport to="body">
      <div v-if="abierto" class="fixed inset-0 z-[70]" @click="abierto = false" />
      <div v-if="abierto" class="fixed z-[80] rounded-[22px] border border-line bg-background p-3 text-ink shadow-2xl"
        :style="{ top: `${panel.top}px`, left: `${panel.left}px`, width: `${panel.width}px`, maxWidth: 'calc(100vw - 16px)' }">
        <div class="mb-2 flex items-center justify-between">
          <button type="button" class="rounded-lg p-1 hover:bg-background-soft" @click="nivel === 'anios' ? vista.y -= 10 : nivel === 'meses' ? vista.y-- : moverMes(-1)"><ChevronLeftIcon class="h-5 w-5" /></button>
          <button type="button" class="flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold hover:bg-background-soft" @click="nivel = nivel === 'dias' ? 'meses' : 'anios'">
            {{ nivel === 'anios' ? `${decadaBase} - ${decadaBase + 9}` : nivel === 'meses' ? vista.y : tituloMes }}<ChevronDownIcon class="h-4 w-4 text-muted" />
          </button>
          <button type="button" class="rounded-lg p-1 hover:bg-background-soft" @click="nivel === 'anios' ? vista.y += 10 : nivel === 'meses' ? vista.y++ : moverMes(1)"><ChevronRightIcon class="h-5 w-5" /></button>
        </div>
        <div v-if="nivel === 'anios'" class="grid grid-cols-4 gap-1">
          <button v-for="anio in anios" :key="anio" type="button" class="rounded-lg px-1 py-2 text-sm hover:bg-background-soft disabled:opacity-30"
            :disabled="anio < Number(min.slice(0, 4)) || anio > Number(maxDia.slice(0, 4))" @click="elegirAnio(anio)">{{ anio }}</button>
        </div>
        <div v-else-if="nivel === 'meses'" class="grid grid-cols-3 gap-1.5 py-2">
          <button v-for="(mes, indice) in MESES" :key="mes" type="button" :disabled="mesDeshabilitado(indice + 1)"
            class="min-w-0 truncate rounded-xl px-1 py-3 text-xs font-medium hover:bg-background-soft disabled:opacity-25 sm:text-sm"
            :class="vista.m === indice + 1 ? 'bg-primary/10 text-primary' : ''" @click="elegirMes(indice + 1)">{{ mes }}</button>
        </div>
        <template v-else>
          <div class="grid grid-cols-7 text-center text-[11px] font-semibold text-muted"><span v-for="dia in DIAS" :key="dia" class="py-1">{{ dia }}</span></div>
          <div class="grid grid-cols-7 gap-0.5 text-center text-sm">
            <button v-for="c in celdas" :key="`${c.y}-${c.m}-${c.d}`" type="button" class="rounded-lg py-1.5 disabled:opacity-20"
              :disabled="deshabilitado(c.y, c.m, c.d)" :class="valor.slice(0, 10) === fmt(c.y, c.m, c.d) ? 'bg-primary font-bold text-white' : c.otro ? 'text-muted/50' : 'hover:bg-background-soft'"
              @click="elegir(c.y, c.m, c.d)">{{ c.d }}</button>
          </div>
        </template>
        <div class="mt-2 flex justify-between border-t border-line pt-2 text-sm">
          <button type="button" class="text-muted hover:text-ink" @click="emit('update:modelValue', ''); abierto = false">Borrar</button>
          <button type="button" class="font-semibold text-primary hover:underline" @click="irHoy">Hoy</button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
