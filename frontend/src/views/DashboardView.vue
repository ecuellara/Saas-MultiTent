<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRightIcon, BuildingOffice2Icon, CheckBadgeIcon, KeyIcon, Squares2X2Icon } from '@heroicons/vue/24/outline'
import { NAVEGACION } from '../components/layout/navigation'
import { useSessionStore } from '../stores/session'
const sesion = useSessionStore()
const features = computed(() => Object.entries(sesion.activa?.features ?? {}).filter(([, v]) => v.habilitado).map(([clave, v]) => ({ clave, limite: v.limite })))
const permisos = computed(() => [...(sesion.activa?.permissions ?? [])].sort())
const accesos = computed(() => NAVEGACION.filter((i) => i.ruta !== '/' && (!i.permiso || sesion.puede(i.permiso)) && (!i.feature || sesion.tieneFeature(i.feature))).slice(0, 6))
</script>
<template>
  <div class="space-y-5">
    <section class="overflow-hidden rounded-[28px] border border-line bg-background shadow-sm">
      <div class="grid gap-6 p-6 lg:grid-cols-[1.25fr_.75fr] lg:p-8">
        <div><div class="inline-flex items-center gap-2 rounded-full border border-line bg-background-soft/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.22em] text-muted"><Squares2X2Icon class="h-4 w-4 text-secondary" />Centro de control</div><h2 class="mt-5 text-3xl font-semibold tracking-tight text-ink">Todo listo para operar en {{ sesion.clinicaActiva?.nombre ?? 'tu clínica' }}.</h2><p class="mt-3 max-w-2xl text-sm leading-6 text-muted">Accede a los módulos habilitados para tu rol y mantén el contexto de esta clínica en cada operación.</p><div class="mt-6 flex flex-wrap gap-2"><RouterLink v-for="item in accesos.slice(0,2)" :key="item.ruta" :to="item.ruta" class="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-dark">{{ item.etiqueta }}<ArrowRightIcon class="h-4 w-4" /></RouterLink></div></div>
        <div class="grid grid-cols-2 gap-3"><div class="rounded-2xl border border-line bg-background-soft/60 p-4"><BuildingOffice2Icon class="h-5 w-5 text-secondary" /><p class="mt-3 text-2xl font-semibold">{{ sesion.clinicas.length }}</p><p class="text-xs text-muted">Clínicas accesibles</p></div><div class="rounded-2xl border border-line bg-background-soft/60 p-4"><CheckBadgeIcon class="h-5 w-5 text-success" /><p class="mt-3 text-2xl font-semibold">{{ features.length }}</p><p class="text-xs text-muted">Funciones activas</p></div><div class="rounded-2xl border border-line bg-background-soft/60 p-4"><KeyIcon class="h-5 w-5 text-primary" /><p class="mt-3 text-2xl font-semibold">{{ permisos.length }}</p><p class="text-xs text-muted">Permisos efectivos</p></div><div class="rounded-2xl border border-line bg-background-soft/60 p-4"><p class="text-xs font-semibold uppercase tracking-wide text-muted">Rol</p><p class="mt-3 truncate text-lg font-semibold">{{ sesion.rol || '—' }}</p><p class="text-xs text-muted">Contexto actual</p></div></div>
      </div>
    </section>
    <div class="grid gap-5 lg:grid-cols-2">
      <section class="rounded-[28px] border border-line bg-background p-5 shadow-sm"><h3 class="text-lg font-semibold">Módulos disponibles</h3><p class="mt-1 text-sm text-muted">Atajos según tus permisos y el plan de la clínica.</p><div class="mt-4 grid gap-2 sm:grid-cols-2"><RouterLink v-for="item in accesos" :key="item.ruta" :to="item.ruta" class="group flex items-center gap-3 rounded-2xl border border-line bg-background-soft/50 p-3 transition hover:border-primary"><span class="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><component :is="item.icono" class="h-5 w-5" /></span><span class="font-medium">{{ item.etiqueta }}</span><ArrowRightIcon class="ml-auto h-4 w-4 text-muted group-hover:text-primary" /></RouterLink></div></section>
      <section class="rounded-[28px] border border-line bg-background p-5 shadow-sm"><h3 class="text-lg font-semibold">Plan y funcionalidades</h3><p v-if="features.length === 0" class="mt-4 text-sm text-muted">Sin funcionalidades habilitadas.</p><ul v-else class="mt-4 space-y-2"><li v-for="f in features" :key="f.clave" class="flex justify-between rounded-2xl bg-background-soft/60 px-4 py-3 text-sm"><span class="text-muted">{{ f.clave }}</span><span class="font-medium">{{ f.limite === null ? 'Sin límite' : f.limite }}</span></li></ul></section>
    </div>
    <section class="rounded-[28px] border border-line bg-background p-5 shadow-sm"><h3 class="text-lg font-semibold">Permisos efectivos <span class="font-normal text-muted">({{ permisos.length }})</span></h3><div class="mt-4 flex flex-wrap gap-2"><span v-for="p in permisos" :key="p" class="rounded-full bg-background-soft px-3 py-1 font-mono text-xs text-muted">{{ p }}</span></div></section>
  </div>
</template>
