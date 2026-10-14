<script setup lang="ts">
import type { Component } from 'vue'
defineProps<{ etiqueta: string; titulo: string; descripcion: string; icono: Component; metrica?: string; metricaEtiqueta?: string }>()
</script>
<template>
  <section class="overflow-hidden rounded-[28px] border border-line bg-background shadow-sm">
    <div class="grid gap-6 p-6 lg:grid-cols-[1fr_auto] lg:items-center lg:p-8">
      <div><div class="inline-flex items-center gap-2 rounded-full border border-line bg-background-soft/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.22em] text-muted"><component :is="icono" class="h-4 w-4 text-secondary" />{{ etiqueta }}</div><h2 class="mt-4 text-3xl font-semibold tracking-tight text-ink">{{ titulo }}</h2><p class="mt-2 max-w-2xl text-sm leading-6 text-muted">{{ descripcion }}</p></div>
      <div class="flex flex-wrap items-center gap-3"><div v-if="metrica" class="min-w-36 rounded-2xl border border-line bg-background-soft/60 p-4"><p class="text-xs font-semibold uppercase tracking-[.16em] text-muted">{{ metricaEtiqueta }}</p><p class="mt-2 text-2xl font-semibold text-ink">{{ metrica }}</p></div><slot /></div>
    </div>
  </section>
</template>
