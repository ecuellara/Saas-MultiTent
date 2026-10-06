<script setup lang="ts">
defineProps<{
  titulo: string
  descripcion: string
}>()
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <h2 class="text-lg font-semibold text-ink">{{ titulo }}</h2>
    <p class="mt-1 text-sm text-muted">{{ descripcion }}</p>

    <div class="mt-6 rounded-lg border border-dashed border-line bg-background p-6">
      <p class="text-sm text-muted">
        Módulo pendiente de construir. La navegación, el permiso
        <code class="rounded bg-background-soft px-1 py-0.5 text-xs">meta.permiso</code>
        y la clínica activa ya están enlazados: falta la vista.
      </p>
    </div>
  </div>
</template>
