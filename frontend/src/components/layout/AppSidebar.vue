<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeftStartOnRectangleIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import { useRouter } from 'vue-router'
import { useSessionStore } from '../../stores/session'
import { NAVEGACION, type ItemNavegacion } from './navigation'
import ThemeToggle from '../ui/ThemeToggle.vue'
const emit = defineEmits<{ cerrar: [] }>()

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
const secciones = computed(() => ['Principal', 'Operación', 'Administración', 'Sistema'].map((nombre) => ({ nombre, items: items.value.filter((i) => i.seccion === nombre) })).filter((s) => s.items.length))

async function cambiarClinica(evento: Event): Promise<void> {
  const id = (evento.target as HTMLSelectElement).value
  if (id === sesion.tenantId) return
  await sesion.elegirClinica(id)
  // Los permisos cambian con la clínica: al panel, para no quedarse en una ruta
  // que el nuevo rol no permite.
  await router.push({ name: 'dashboard' })
}
async function salir(): Promise<void> { await sesion.cerrarSesion(); await router.replace({ name: 'login' }) }
</script>

<template>
  <aside class="flex h-screen w-64 shrink-0 flex-col overflow-hidden border-r border-line bg-background/95 shadow-[12px_0_40px_-28px_rgba(7,86,163,.65)] backdrop-blur-xl">
    <!-- Marca / clínica activa -->
    <div class="shrink-0 border-b border-line px-4 py-5">
      <div class="mb-4 flex items-center gap-3"><div class="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-primary"><img v-if="sesion.logoMarca" :src="sesion.logoMarca" class="h-full w-full object-contain" alt="Logo de la clínica" /><img v-else src="/favicon.svg" class="h-7 w-7" alt="" /></div><div class="min-w-0"><p class="text-xs font-semibold uppercase tracking-[.18em] text-muted">Dental SaaS</p><p class="truncate text-sm font-semibold text-ink">Gestión clínica</p></div><button class="ml-auto rounded-lg p-1.5 text-muted hover:bg-background-soft md:hidden" @click="emit('cerrar')"><XMarkIcon class="h-5 w-5" /></button></div>
      <p class="truncate text-sm font-semibold text-ink" :title="sesion.clinicaActiva?.nombre">
        {{ sesion.clinicaActiva?.nombre ?? 'Clínica' }}
      </p>
      <p class="mt-0.5 text-xs text-muted">{{ sesion.rol }}</p>

      <!-- Selector de clínica: solo si el usuario pertenece a más de una. -->
      <select
        v-if="variasClinicas"
        class="mt-3 w-full rounded-xl border border-line bg-background-soft/60 px-3 py-2.5 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-secondary/30"
        :value="sesion.tenantId"
        aria-label="Cambiar de clínica"
        @change="cambiarClinica"
      >
        <option v-for="c in sesion.clinicas" :key="c.id" :value="c.id">{{ c.nombre }}</option>
      </select>
    </div>

    <!-- Navegación -->
    <nav class="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      <div v-for="seccion in secciones" :key="seccion.nombre" class="mb-5">
      <p class="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-muted">{{ seccion.nombre }}</p>
      <RouterLink
        v-for="item in seccion.items"
        :key="item.ruta"
        :to="item.ruta"
        class="mb-1 flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-muted transition hover:bg-background-soft hover:text-ink"
        active-class="bg-primary font-semibold text-white shadow-sm hover:bg-primary hover:text-white"
        :exact-active-class="item.ruta === '/' ? 'bg-primary font-semibold text-white shadow-sm' : ''"
        @click="emit('cerrar')"
      >
        <component :is="item.icono" class="h-5 w-5 shrink-0" aria-hidden="true" />
        <span class="truncate">{{ item.etiqueta }}</span>
      </RouterLink>
      </div>
    </nav>

    <!-- Usuario -->
    <div class="shrink-0 border-t border-line px-4 py-4">
      <p class="truncate text-sm font-medium text-ink">{{ sesion.usuario?.nombre }}</p>
      <p class="truncate text-xs text-muted" :title="sesion.usuario?.email">
        {{ sesion.usuario?.email }}
      </p>
      <div class="mt-3 flex items-center gap-2"><ThemeToggle compacto /><button type="button" class="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted hover:bg-background-soft hover:text-ink" @click="salir"><ArrowLeftStartOnRectangleIcon class="h-4 w-4" />Salir</button></div>
    </div>
  </aside>
</template>
