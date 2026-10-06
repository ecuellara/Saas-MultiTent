<script setup lang="ts">
/** Aviso de error homogéneo: mismo aspecto y `role="alert"` en toda la app. */
defineProps<{ mensaje: string }>()
</script>

<template>
  <p class="rounded-md bg-error/10 px-3 py-2 text-xs text-error" role="alert">
    {{ mensaje }}
  </p>
</template>
