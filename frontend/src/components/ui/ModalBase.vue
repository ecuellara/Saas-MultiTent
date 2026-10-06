<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

withDefaults(
  defineProps<{
    titulo: string
    /** Ancho máximo del diálogo. */
    ancho?: 'sm' | 'md' | 'lg'
  }>(),
  { ancho: 'md' },
)

const emit = defineEmits<{ cerrar: [] }>()

const ANCHOS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-3xl' } as const

/** Escape cierra: es lo que espera cualquiera que use el teclado. */
function alPulsarTecla(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('cerrar')
}

onMounted(() => document.addEventListener('keydown', alPulsarTecla))
onUnmounted(() => document.removeEventListener('keydown', alPulsarTecla))
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
    role="dialog"
    aria-modal="true"
    @click.self="emit('cerrar')"
  >
    <div
      class="w-full rounded-lg border border-line bg-background shadow-xl"
      :class="ANCHOS[ancho]"
    >
      <header class="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
        <h2 class="truncate text-sm font-semibold text-ink">{{ titulo }}</h2>
        <button
          type="button"
          class="rounded p-1 text-muted hover:bg-background-soft hover:text-ink"
          aria-label="Cerrar"
          @click="emit('cerrar')"
        >
          <svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="px-4 py-4">
        <slot />
      </div>

      <footer v-if="$slots.pie" class="border-t border-line px-4 py-3">
        <slot name="pie" />
      </footer>
    </div>
  </div>
</template>
