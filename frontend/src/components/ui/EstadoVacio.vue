<script setup lang="ts">
/** Estado vacío homogéneo (sin resultados, sin datos, sin permiso). */
defineProps<{ titulo: string; detalle?: string }>()
</script>

<template>
  <div class="rounded-lg border border-dashed border-line bg-background p-8 text-center">
    <p class="text-sm font-medium text-ink">{{ titulo }}</p>
    <p v-if="detalle" class="mt-1 text-xs text-muted">{{ detalle }}</p>
    <slot />
  </div>
</template>
