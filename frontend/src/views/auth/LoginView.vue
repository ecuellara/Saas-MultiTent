<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSessionStore } from '../../stores/session'

const sesion = useSessionStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const expirada = computed(() => route.query.expirada === '1')

async function entrar(): Promise<void> {
  const ok = await sesion.iniciarSesion(email.value.trim(), password.value)
  if (!ok) return

  // El destino puede ser una ruta recordada por el guard. El guard se encarga de
  // resolver la clínica (auto si solo hay una, selector si hay varias).
  const destino = typeof route.query.destino === 'string' ? route.query.destino : '/'
  await router.replace(destino)
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background-soft px-4">
    <div class="w-full max-w-sm">
      <div class="mb-6 text-center">
        <h1 class="text-xl font-semibold text-ink">Gestión de clínica dental</h1>
        <p class="mt-1 text-sm text-muted">Accede con tu cuenta.</p>
      </div>

      <form
        class="rounded-lg border border-line bg-background p-6 shadow-sm"
        @submit.prevent="entrar"
      >
        <p
          v-if="expirada"
          class="mb-4 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning"
          role="status"
        >
          Tu sesión expiró. Vuelve a entrar.
        </p>

        <label class="mb-1 block text-sm font-medium text-ink" for="email">Correo</label>
        <input
          id="email"
          v-model="email"
          type="email"
          required
          autocomplete="username"
          class="mb-4 w-full rounded-md border border-line bg-background-soft px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />

        <label class="mb-1 block text-sm font-medium text-ink" for="password">Contraseña</label>
        <input
          id="password"
          v-model="password"
          type="password"
          required
          autocomplete="current-password"
          class="w-full rounded-md border border-line bg-background-soft px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />

        <p v-if="sesion.error" class="mt-3 text-xs text-error" role="alert">
          {{ sesion.error }}
        </p>

        <button
          type="submit"
          :disabled="sesion.cargando"
          class="mt-5 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-primary-dark disabled:opacity-60"
        >
          {{ sesion.cargando ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>
    </div>
  </div>
</template>
