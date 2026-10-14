<script setup lang="ts">
import { MoonIcon, SunIcon } from '@heroicons/vue/24/outline'
import { useThemeStore } from '../../stores/theme'
defineProps<{ compacto?: boolean }>()
const tema = useThemeStore()
</script>
<template>
  <button type="button" class="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-background/80 p-2 text-muted shadow-sm backdrop-blur hover:text-ink"
    :aria-label="tema.oscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'" @click="tema.alternar()">
    <SunIcon v-if="tema.oscuro" class="h-5 w-5" /><MoonIcon v-else class="h-5 w-5" />
    <span v-if="!compacto" class="text-xs">{{ tema.oscuro ? 'Tema claro' : 'Tema oscuro' }}</span>
  </button>
</template>
