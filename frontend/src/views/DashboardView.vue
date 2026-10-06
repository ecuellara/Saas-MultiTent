<script setup lang="ts">
import { computed } from 'vue'
import { useSessionStore } from '../stores/session'

const sesion = useSessionStore()

/** Se listan las features habilitadas para comprobar de un vistazo el plan. */
const features = computed(() =>
  Object.entries(sesion.activa?.features ?? {})
    .filter(([, v]) => v.habilitado)
    .map(([clave, v]) => ({ clave, limite: v.limite })),
)

const permisos = computed(() => [...(sesion.activa?.permissions ?? [])].sort())
</script>

<template>
  <div class="mx-auto max-w-4xl">
    <h2 class="text-lg font-semibold text-ink">Panel</h2>
    <p class="mt-1 text-sm text-muted">
      Sesión resuelta contra el backend. Esta pantalla sirve de comprobación del
      enlazado multi-clínica mientras se construyen los módulos.
    </p>

    <div class="mt-6 grid gap-4 sm:grid-cols-2">
      <section class="rounded-lg border border-line bg-background p-4">
        <h3 class="text-sm font-medium text-ink">Clínica activa</h3>
        <dl class="mt-3 space-y-2 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-muted">Nombre</dt>
            <dd class="truncate text-ink">{{ sesion.clinicaActiva?.nombre ?? '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted">Identificador</dt>
            <dd class="truncate font-mono text-xs text-ink">{{ sesion.tenantId || '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted">Rol</dt>
            <dd class="text-ink">{{ sesion.rol || '—' }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-muted">Clínicas accesibles</dt>
            <dd class="text-ink">{{ sesion.clinicas.length }}</dd>
          </div>
        </dl>
      </section>

      <section class="rounded-lg border border-line bg-background p-4">
        <h3 class="text-sm font-medium text-ink">Plan</h3>
        <p v-if="features.length === 0" class="mt-3 text-sm text-muted">
          Sin funcionalidades habilitadas (no hay suscripción activa).
        </p>
        <ul v-else class="mt-3 space-y-2 text-sm">
          <li v-for="f in features" :key="f.clave" class="flex justify-between gap-4">
            <span class="text-muted">{{ f.clave }}</span>
            <span class="text-ink">{{ f.limite === null ? 'sin límite' : f.limite }}</span>
          </li>
        </ul>
      </section>
    </div>

    <section class="mt-4 rounded-lg border border-line bg-background p-4">
      <h3 class="text-sm font-medium text-ink">
        Permisos efectivos
        <span class="font-normal text-muted">({{ permisos.length }})</span>
      </h3>
      <p v-if="permisos.length === 0" class="mt-3 text-sm text-muted">Sin permisos.</p>
      <div v-else class="mt-3 flex flex-wrap gap-1.5">
        <span
          v-for="p in permisos"
          :key="p"
          class="rounded bg-background-soft px-2 py-0.5 font-mono text-xs text-muted"
        >
          {{ p }}
        </span>
      </div>
      <p class="mt-3 text-xs text-muted">
        El menú oculta lo que no puedes usar, pero quien autoriza de verdad es el
        backend: cada petición se valida allí.
      </p>
    </section>
  </div>
</template>
