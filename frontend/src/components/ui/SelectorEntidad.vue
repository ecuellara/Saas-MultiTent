<script setup lang="ts">
import { computed, ref } from 'vue'

/**
 * Selector con búsqueda.
 *
 * Un `<select>` nativo con doscientos pacientes es inmanejable, y un
 * `<input list>` no permite distinguir dos homónimos (mismo texto, distinta
 * persona). Aquí se filtra por texto y cada opción muestra su etiqueta completa.
 */
const props = withDefaults(
  defineProps<{
    modelo: string
    opciones: Array<{ valor: string; etiqueta: string }>
    placeholder?: string
    /** Texto de la opción «sin selección»; si no se indica, no se ofrece. */
    vacio?: string
    deshabilitado?: boolean
  }>(),
  { placeholder: 'Buscar…', vacio: '', deshabilitado: false },
)

const emit = defineEmits<{ 'update:modelo': [string] }>()

const abierto = ref(false)
const filtro = ref('')

const seleccionada = computed(() => props.opciones.find((o) => o.valor === props.modelo) ?? null)

const filtradas = computed(() => {
  const q = filtro.value.trim().toLowerCase()
  const base = q ? props.opciones.filter((o) => o.etiqueta.toLowerCase().includes(q)) : props.opciones
  // Se acota la lista pintada: cientos de nodos por pulsación es lo que hace que
  // un selector se sienta lento.
  return base.slice(0, 50)
})

function alternar(): void {
  if (props.deshabilitado) return
  abierto.value = !abierto.value
  filtro.value = ''
}

function elegir(valor: string): void {
  emit('update:modelo', valor)
  abierto.value = false
  filtro.value = ''
}
</script>

<template>
  <div class="relative">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-left text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
      :disabled="deshabilitado"
      @click="alternar"
    >
      <span class="truncate" :class="seleccionada ? 'text-ink' : 'text-muted'">
        {{ seleccionada?.etiqueta ?? (vacio || 'Sin selección') }}
      </span>
      <svg
        class="h-4 w-4 shrink-0 text-muted"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        viewBox="0 0 24 24"
      >
        <path stroke-linecap="round" d="M6 9l6 6 6-6" />
      </svg>
    </button>

    <!-- Capa transparente que cierra al pulsar fuera: evita tener que escuchar
         eventos del documento en cada selector de la aplicación. -->
    <div v-if="abierto" class="fixed inset-0 z-10" @click="abierto = false" />

    <div
      v-if="abierto"
      class="absolute z-20 mt-1 w-full rounded-md border border-line bg-background shadow-lg"
    >
      <input
        v-model="filtro"
        type="text"
        :placeholder="placeholder"
        class="w-full border-b border-line bg-background px-3 py-2 text-sm text-ink focus:outline-none"
        @keydown.escape="abierto = false"
      />
      <ul class="max-h-56 overflow-y-auto py-1">
        <li v-if="vacio">
          <button
            type="button"
            class="w-full px-3 py-1.5 text-left text-sm text-muted hover:bg-background-soft"
            @click="elegir('')"
          >
            {{ vacio }}
          </button>
        </li>
        <li v-if="filtradas.length === 0 && !vacio">
          <p class="px-3 py-2 text-xs text-muted">Sin coincidencias</p>
        </li>
        <li v-for="o in filtradas" :key="o.valor">
          <button
            type="button"
            class="w-full px-3 py-1.5 text-left text-sm hover:bg-background-soft"
            :class="o.valor === modelo ? 'font-medium text-primary' : 'text-ink'"
            @click="elegir(o.valor)"
          >
            {{ o.etiqueta }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
