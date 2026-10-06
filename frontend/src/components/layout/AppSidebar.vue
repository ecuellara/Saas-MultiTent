<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../../stores/session'
import { NAVEGACION, type ItemNavegacion } from './navigation'

const sesion = useSessionStore()
const router = useRouter()

/**
 * Solo se pintan los items permitidos por el rol y habilitados por el plan.
 * Esto es comodidad, no seguridad: cada endpoint valida por su cuenta.
 */
const items = computed<ItemNavegacion[]>(() =>
  NAVEGACION.filter((i) => {
    if (i.permiso && !sesion.puede(i.permiso)) return false
    if (i.feature && !sesion.tieneFeature(i.feature)) return false
    return true
  }),
)

const variasClinicas = computed(() => sesion.clinicas.length > 1)

async function cambiarClinica(evento: Event): Promise<void> {
  const id = (evento.target as HTMLSelectElement).value
  if (id === sesion.tenantId) return
  await sesion.elegirClinica(id)
  // Los permisos cambian con la clínica: al panel, para no quedarse en una ruta
  // que el nuevo rol no permite.
  await router.push({ name: 'dashboard' })
}
</script>

<template>
  <aside class="flex h-full w-64 shrink-0 flex-col border-r border-line bg-background">
    <!-- Marca / clínica activa -->
    <div class="border-b border-line px-4 py-4">
      <p class="truncate text-sm font-semibold text-ink" :title="sesion.clinicaActiva?.nombre">
        {{ sesion.clinicaActiva?.nombre ?? 'Clínica' }}
      </p>
      <p class="mt-0.5 text-xs text-muted">{{ sesion.rol }}</p>

      <!-- Selector de clínica: solo si el usuario pertenece a más de una. -->
      <select
        v-if="variasClinicas"
        class="mt-3 w-full rounded-md border border-line bg-background-soft px-2 py-1.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        :value="sesion.tenantId"
        aria-label="Cambiar de clínica"
        @change="cambiarClinica"
      >
        <option v-for="c in sesion.clinicas" :key="c.id" :value="c.id">{{ c.nombre }}</option>
      </select>
    </div>

    <!-- Navegación -->
    <nav class="flex-1 overflow-y-auto px-2 py-3">
      <RouterLink
        v-for="item in items"
        :key="item.ruta"
        :to="item.ruta"
        class="mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-background-soft hover:text-ink"
        active-class="bg-background-soft font-medium text-primary"
        :exact-active-class="item.ruta === '/' ? 'bg-background-soft font-medium text-primary' : ''"
      >
        <component :is="item.icono" class="h-5 w-5 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ item.etiqueta }}</span>
      </RouterLink>
    </nav>

    <!-- Usuario -->
    <div class="border-t border-line px-4 py-3">
      <p class="truncate text-sm font-medium text-ink">{{ sesion.usuario?.nombre }}</p>
      <p class="truncate text-xs text-muted" :title="sesion.usuario?.email">
        {{ sesion.usuario?.email }}
      </p>
    </div>
  </aside>
</template>
