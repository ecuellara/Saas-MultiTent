<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppSidebar from '../components/layout/AppSidebar.vue'
import { NAVEGACION } from '../components/layout/navigation'
import { useSessionStore } from '../stores/session'
import { useThemeStore } from '../stores/theme'

const sesion = useSessionStore()
const tema = useThemeStore()
const router = useRouter()
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

async function salir(): Promise<void> {
  await sesion.cerrarSesion()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-background-soft">
    <!-- Menú fijo en escritorio -->
    <div class="hidden md:flex">
      <AppSidebar />
    </div>

    <!-- Menú superpuesto en móvil -->
    <div v-if="menuAbierto" class="fixed inset-0 z-40 flex md:hidden">
      <AppSidebar />
      <button
        class="flex-1 bg-black/40"
        aria-label="Cerrar menú"
        @click="menuAbierto = false"
      />
    </div>

    <div class="flex min-w-0 flex-1 flex-col">
      <header
        class="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-background px-4"
      >
        <button
          class="rounded-md p-2 text-muted hover:bg-background-soft hover:text-ink md:hidden"
          aria-label="Abrir menú"
          @click="menuAbierto = true"
        >
          <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <h1 class="truncate text-sm font-medium text-ink">{{ titulo }}</h1>

        <div class="ml-auto flex items-center gap-2">
          <button
            class="rounded-md p-2 text-muted hover:bg-background-soft hover:text-ink"
            :aria-label="tema.oscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'"
            @click="tema.alternar()"
          >
            <svg
              v-if="tema.oscuro"
              class="h-5 w-5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="4" />
              <path
                stroke-linecap="round"
                d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
              />
            </svg>
            <svg
              v-else
              class="h-5 w-5"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path stroke-linecap="round" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          </button>

          <button
            class="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-background-soft hover:text-ink"
            @click="salir"
          >
            Salir
          </button>
        </div>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
