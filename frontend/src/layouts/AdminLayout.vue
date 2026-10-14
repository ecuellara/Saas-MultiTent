<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { usePlataformaStore } from '../stores/plataforma'

/**
 * Marco del panel de plataforma. SEPARADO del área de clínica (`AppLayout`)
 * a propósito: sin selector de clínica, sin menú clínico y sin cabecera
 * `X-Tenant-Id` (las rutas van con `PlatformGuard`, invariante 1).
 */
const plataforma = usePlataformaStore()
const router = useRouter()
const route = useRoute()

async function salir(): Promise<void> {
  await plataforma.cerrarSesion()
  await router.replace({ name: 'admin-login' })
}

function rutaActiva(...nombres: string[]): boolean {
  return nombres.includes(String(route.name ?? ''))
}
</script>

<template>
  <div class="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top_left,_rgba(18,184,206,0.10),_transparent_28%),linear-gradient(180deg,_#f8fbfd_0%,_#eef5f8_100%)] dark:bg-[linear-gradient(180deg,#0b141c,#0a1219)]">
    <header class="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 border-b border-line bg-background/95 px-5 shadow-sm backdrop-blur">
      <span class="rounded-xl bg-primary px-3 py-2 text-sm font-semibold text-white">Plataforma</span>
      <nav class="flex items-center gap-1 text-sm" aria-label="Panel de plataforma">
        <RouterLink
          :to="{ name: 'admin-clinicas' }"
           class="rounded-full px-4 py-2"
           :class="rutaActiva('admin-clinicas', 'admin-clinica-detalle') ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-background-soft hover:text-ink'"
        >
          Clínicas
        </RouterLink>
        <RouterLink
          :to="{ name: 'admin-clinica-alta' }"
           class="rounded-full px-4 py-2"
           :class="rutaActiva('admin-clinica-alta') ? 'bg-primary/10 font-semibold text-primary' : 'text-muted hover:bg-background-soft hover:text-ink'"
        >
          Alta
        </RouterLink>
      </nav>
      <div class="ml-auto flex items-center gap-2">
        <span v-if="plataforma.ownerEmail" class="hidden truncate text-xs text-muted sm:block">
          {{ plataforma.ownerEmail }}
        </span>
        <button
          class="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-background-soft hover:text-ink"
          @click="salir"
        >
          Salir
        </button>
      </div>
    </header>

     <main class="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
      <RouterView />
    </main>
  </div>
</template>
