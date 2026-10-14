<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppSidebar from '../components/layout/AppSidebar.vue'
import { NAVEGACION } from '../components/layout/navigation'

const route = useRoute()

/** Título de la sección actual, tomado del propio menú (una sola fuente). */
const titulo = computed(() => {
  const exacto = NAVEGACION.find((i) => i.ruta === route.path)
  if (exacto) return exacto.etiqueta
  // Rutas anidadas (`/pacientes/:id`) heredan el título de su sección.
  const porPrefijo = NAVEGACION.find(
    (i) => i.ruta !== '/' && route.path.startsWith(`${i.ruta}/`),
  )
  return porPrefijo?.etiqueta ?? ''
})

/** En pantallas pequeñas el menú se superpone en vez de ocupar sitio fijo. */
const menuAbierto = ref(false)

</script>

<template>
  <div class="flex min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(18,184,206,0.10),_transparent_28%),linear-gradient(180deg,_#f8fbfd_0%,_#eef5f8_100%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(59,157,240,0.12),_transparent_30%),linear-gradient(180deg,_#0b141c_0%,_#0a1219_100%)]">
    <!-- Menú fijo en escritorio -->
    <div class="hidden md:flex">
      <AppSidebar />
    </div>

    <!-- Menú superpuesto en móvil -->
    <div v-if="menuAbierto" class="fixed inset-0 z-40 flex md:hidden">
       <AppSidebar @cerrar="menuAbierto = false" />
      <button
        class="flex-1 bg-black/40"
        aria-label="Cerrar menú"
        @click="menuAbierto = false"
      />
    </div>

    <div class="flex min-w-0 flex-1 flex-col">
       <header class="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 bg-background px-4 shadow-sm md:hidden">
        <button
          class="rounded-md p-2 text-muted hover:bg-background-soft hover:text-ink md:hidden"
          aria-label="Abrir menú"
          @click="menuAbierto = true"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

         <img src="/favicon.svg" class="h-8 w-8" alt="" /><h1 class="truncate text-sm font-semibold text-ink">{{ titulo }}</h1>
      </header>

       <main class="relative flex-1">
         <div class="mx-auto w-full max-w-7xl space-y-5 px-4 py-4 sm:px-6 sm:py-6">
           <div class="hidden md:block"><p class="text-xs font-semibold uppercase tracking-[.24em] text-muted">{{ titulo }}</p><h1 class="mt-1 text-2xl font-semibold tracking-tight text-ink">{{ titulo }}</h1></div>
           <RouterView />
         </div>
      </main>
    </div>
  </div>
</template>
