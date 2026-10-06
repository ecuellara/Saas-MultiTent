<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
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
  <div class="flex min-h-screen items-center justify-center bg-background-soft px-4">
    <div class="w-full max-w-md">
      <h1 class="text-lg font-semibold text-ink">Elige una clínica</h1>
      <p class="mt-1 text-sm text-muted">
        Tu cuenta tiene acceso a {{ sesion.clinicas.length }} clínicas.
      </p>

      <p v-if="error" class="mt-4 rounded-md bg-error/10 px-3 py-2 text-xs text-error" role="alert">
        {{ error }}
      </p>

      <ul class="mt-5 space-y-2">
        <li v-for="c in sesion.clinicas" :key="c.id">
          <button
            class="flex w-full items-center justify-between rounded-lg border border-line bg-background px-4 py-3 text-left transition-colors hover:border-primary disabled:opacity-60"
            :disabled="entrando !== ''"
            @click="elegir(c.id)"
          >
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium text-ink">{{ c.nombre }}</span>
              <span class="block truncate text-xs text-muted">{{ c.rol }}</span>
            </span>
            <span class="ml-3 shrink-0 text-xs text-primary">
              {{ entrando === c.id ? 'Entrando…' : 'Entrar' }}
            </span>
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
