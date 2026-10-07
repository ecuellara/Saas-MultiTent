<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AvisoError from '../../components/ui/AvisoError.vue'
import { usePlataformaStore } from '../../stores/plataforma'

/**
 * Login de plataforma con el flujo MFA completo, sin atajos:
 * clave → (`setup`: mostrar secreto → confirmar → volver a clave) → `verify`.
 */
const plataforma = usePlataformaStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const codigo = ref('')
const expirada = computed(() => route.query.expirada === '1')

async function entrar(): Promise<void> {
  const paso = await plataforma.iniciarSesion(email.value, password.value).catch(() => null)
  if (paso === 'ok') {
    await irDestino()
  } else if (paso === 'setup') {
    await plataforma.iniciarSetup().catch(() => undefined)
  }
  // 'verify' y 'setup' se quedan en esta vista mostrando su paso.
}

async function confirmar(): Promise<void> {
  await plataforma.confirmarSetup(codigo.value).catch(() => undefined)
  if (!plataforma.error) {
    // El temporal era de alta: hay que volver a entrar con clave.
    await entrar()
  }
}

async function verificar(): Promise<void> {
  await plataforma.verificar(codigo.value).catch(() => undefined)
  if (!plataforma.error && plataforma.autenticado) {
    await irDestino()
  }
}

async function irDestino(): Promise<void> {
  const destino = typeof route.query.destino === 'string' ? route.query.destino : '/admin'
  await router.replace(destino)
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background-soft px-4">
    <div class="w-full max-w-sm">
      <div class="mb-6 text-center">
        <h1 class="text-xl font-semibold text-ink">Panel de plataforma</h1>
        <p class="mt-1 text-sm text-muted">Acceso restringido al equipo del SaaS.</p>
      </div>

      <p
        v-if="expirada"
        class="mb-4 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning"
        role="status"
      >
        Tu sesión expiró. Vuelve a entrar.
      </p>

      <!-- Paso 1: clave -->
      <form
        v-if="plataforma.paso === 'clave'"
        class="rounded-lg border border-line bg-background p-6 shadow-sm"
        @submit.prevent="entrar"
      >
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
        <AvisoError v-if="plataforma.error" class="mt-3" :mensaje="plataforma.error" />
        <button
          type="submit"
          :disabled="plataforma.cargando"
          class="mt-5 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-primary-dark disabled:opacity-60"
        >
          {{ plataforma.cargando ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>

      <!-- Paso 2: enrolar TOTP -->
      <div
        v-else-if="plataforma.paso === 'setup'"
        class="rounded-lg border border-line bg-background p-6 shadow-sm"
      >
        <h2 class="text-sm font-medium text-ink">Activa la verificación en dos pasos</h2>
        <p class="mt-1 text-xs text-muted">
          Es obligatoria. Añade esta cuenta a tu app autenticadora con el secreto:
        </p>
        <p class="mt-3 select-all break-all rounded-md bg-background-soft px-3 py-2 text-center font-mono text-sm text-ink">
          {{ plataforma.secret }}
        </p>
        <p class="mt-2 break-all text-xs text-muted">{{ plataforma.otpauthUrl }}</p>
        <form @submit.prevent="confirmar">
          <label class="mb-1 mt-4 block text-sm font-medium text-ink" for="codigo-setup">Código de 6 dígitos</label>
          <input
            id="codigo-setup"
            v-model="codigo"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            required
            class="w-full rounded-md border border-line bg-background-soft px-3 py-2 text-center font-mono text-lg tracking-widest text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <AvisoError v-if="plataforma.error" class="mt-3" :mensaje="plataforma.error" />
          <button
            type="submit"
            :disabled="plataforma.cargando"
            class="mt-4 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-primary-dark disabled:opacity-60"
          >
            {{ plataforma.cargando ? 'Verificando…' : 'Confirmar' }}
          </button>
        </form>
        <button
          class="mt-3 w-full text-center text-xs text-muted hover:text-ink"
          @click="plataforma.volverAClave()"
        >
          Usar otra cuenta
        </button>
      </div>

      <!-- Paso 3: verificar TOTP -->
      <form
        v-else
        class="rounded-lg border border-line bg-background p-6 shadow-sm"
        @submit.prevent="verificar"
      >
        <h2 class="text-sm font-medium text-ink">Verificación en dos pasos</h2>
        <label class="mb-1 mt-4 block text-sm font-medium text-ink" for="codigo">Código de 6 dígitos</label>
        <input
          id="codigo"
          v-model="codigo"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          required
          class="w-full rounded-md border border-line bg-background-soft px-3 py-2 text-center font-mono text-lg tracking-widest text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <AvisoError v-if="plataforma.error" class="mt-3" :mensaje="plataforma.error" />
        <button
          type="submit"
          :disabled="plataforma.cargando"
          class="mt-4 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-primary-dark disabled:opacity-60"
        >
          {{ plataforma.cargando ? 'Verificando…' : 'Verificar' }}
        </button>
        <button
          type="button"
          class="mt-3 w-full text-center text-xs text-muted hover:text-ink"
          @click="plataforma.volverAClave()"
        >
          Usar otra cuenta
        </button>
      </form>
    </div>
  </div>
</template>
