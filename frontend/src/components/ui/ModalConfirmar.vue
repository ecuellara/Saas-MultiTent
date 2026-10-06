<script setup lang="ts">
import ModalBase from './ModalBase.vue'

withDefaults(
  defineProps<{
    titulo: string
    mensaje: string
    textoConfirmar?: string
    /** Deshabilita los botones mientras la acción está en curso. */
    ocupado?: boolean
    peligro?: boolean
  }>(),
  { textoConfirmar: 'Confirmar', ocupado: false, peligro: false },
)

const emit = defineEmits<{ confirmar: []; cancelar: [] }>()
</script>

<template>
  <ModalBase :titulo="titulo" ancho="sm" @cerrar="emit('cancelar')">
    <p class="text-sm text-muted">{{ mensaje }}</p>

    <template #pie>
      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
          :disabled="ocupado"
          @click="emit('cancelar')"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          :class="peligro ? 'bg-error hover:opacity-90' : 'bg-primary hover:bg-primary-dark'"
          :disabled="ocupado"
          @click="emit('confirmar')"
        >
          {{ ocupado ? 'Procesando…' : textoConfirmar }}
        </button>
      </div>
    </template>
  </ModalBase>
</template>
