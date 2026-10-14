<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRightIcon, BuildingOffice2Icon } from '@heroicons/vue/24/outline'
import ThemeToggle from '../../components/ui/ThemeToggle.vue'
import { mensajeDeError } from '../../services/errores'
import { useSessionStore } from '../../stores/session'

const sesion = useSessionStore()
const router = useRouter()

const error = ref('')
const entrando = ref('')

async function elegir(tenantId: string): Promise<void> {
  error.value = ''
  entrando.value = tenantId
  try {
    await sesion.elegirClinica(tenantId)
    await router.replace({ name: 'dashboard' })
  } catch (e) {
    // 403 aquí significa que la membresía ya no está activa: se recarga la lista
    // para reflejar la realidad en vez de dejar una tarjeta que no funciona.
    error.value = mensajeDeError(e, 'No se pudo acceder a esa clínica')
    await sesion.cargarSesion().catch(() => undefined)
  } finally {
    entrando.value = ''
  }
}
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#0b5aa8,#0f6fc7_40%,#0a3e7a)] px-4 py-8">
    <img src="/login-bg.svg" alt="" class="absolute inset-0 h-full w-full object-cover opacity-35" />
    <div class="absolute right-4 top-4 z-10"><ThemeToggle compacto /></div>
    <div class="relative w-full max-w-3xl rounded-[2rem] border border-white/20 bg-background/95 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
      <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><BuildingOffice2Icon class="h-7 w-7" /></div><p class="mt-5 text-xs font-semibold uppercase tracking-[.22em] text-muted">Espacio de trabajo</p><h1 class="mt-1 text-3xl font-semibold text-ink">Elige una clínica</h1>
      <p class="mt-1 text-sm text-muted">
        Tu cuenta tiene acceso a {{ sesion.clinicas.length }} clínicas.
      </p>

      <p v-if="error" class="mt-4 rounded-md bg-error/10 px-3 py-2 text-xs text-error" role="alert">
        {{ error }}
      </p>

       <ul class="mt-6 grid gap-3 sm:grid-cols-2">
        <li v-for="c in sesion.clinicas" :key="c.id">
          <button
           class="group flex w-full items-center justify-between rounded-2xl border border-line bg-background px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary disabled:opacity-60"
            :disabled="entrando !== ''"
            @click="elegir(c.id)"
          >
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium text-ink">{{ c.nombre }}</span>
              <span class="block truncate text-xs text-muted">{{ c.rol }}</span>
            </span>
           <span class="ml-3 inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">{{ entrando === c.id ? 'Entrando…' : 'Entrar' }}<ArrowRightIcon v-if="entrando !== c.id" class="h-4 w-4 transition group-hover:translate-x-0.5" /></span>
          </button>
        </li>
      </ul>

      <p v-if="sesion.clinicas.length === 0" class="mt-5 text-sm text-muted">
        Tu cuenta no tiene ninguna clínica asignada. Pide a un administrador que te añada
        al equipo de una clínica.
      </p>
    </div>
  </div>
</template>
