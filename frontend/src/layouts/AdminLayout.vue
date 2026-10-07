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
  <div class="flex min-h-screen flex-col bg-background-soft">
    <header class="flex h-14 shrink-0 items-center gap-4 border-b border-line bg-background px-4">
      <span class="text-sm font-semibold text-ink">Plataforma</span>
      <nav class="flex items-center gap-1 text-sm" aria-label="Panel de plataforma">
        <RouterLink
          :to="{ name: 'admin-clinicas' }"
          class="rounded-md px-3 py-1.5"
          :class="rutaActiva('admin-clinicas', 'admin-clinica-detalle') ? 'bg-background-soft font-medium text-ink' : 'text-muted hover:text-ink'"
        >
          Clínicas
        </RouterLink>
        <RouterLink
          :to="{ name: 'admin-clinica-alta' }"
          class="rounded-md px-3 py-1.5"
          :class="rutaActiva('admin-clinica-alta') ? 'bg-background-soft font-medium text-ink' : 'text-muted hover:text-ink'"
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

    <main class="mx-auto w-full max-w-5xl flex-1 p-4 md:p-6">
      <RouterView />
    </main>
  </div>
</template>
