<script setup lang="ts">
/** Indicador de carga centrado, con texto opcional. */
withDefaults(defineProps<{ texto?: string }>(), { texto: 'Cargando…' })
</script>

<template>
  <p class="py-8 text-center text-sm text-muted" role="status">{{ texto }}</p>
</template>
