<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AvisoError from '../../components/ui/AvisoError.vue'
import ThemeToggle from '../../components/ui/ThemeToggle.vue'
import { ArrowRightIcon, BuildingOffice2Icon, ChartBarSquareIcon, ShieldCheckIcon } from '@heroicons/vue/24/outline'
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
  <div class="relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(135deg,#07131d,#0b2a45_45%,#0756a3)] px-4 py-8">
    <img src="/login-bg.svg" alt="" class="absolute inset-0 h-full w-full object-cover opacity-20" />
    <div class="absolute right-4 top-4 z-10"><ThemeToggle compacto /></div>
    <div class="relative grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-white/15 bg-background shadow-2xl md:grid-cols-[.9fr_1.1fr]">
      <div class="relative hidden flex-col justify-between overflow-hidden bg-primary p-9 text-white md:flex">
        <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,.2),transparent_30%),linear-gradient(160deg,rgba(7,86,163,.95),rgba(18,184,206,.75))]" />
        <div class="relative"><div class="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.22em]">Acceso interno</div><div class="mt-7 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15"><ShieldCheckIcon class="h-8 w-8" /></div><h2 class="mt-5 text-3xl font-semibold">Operación de plataforma</h2><p class="mt-3 text-sm leading-6 text-white/80">Gestiona clínicas, planes y suscripciones desde un entorno protegido con MFA.</p></div>
        <div class="relative space-y-3 text-sm text-white/90"><p class="flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-2"><BuildingOffice2Icon class="h-5 w-5" />Administración multi-clínica</p><p class="flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-2"><ChartBarSquareIcon class="h-5 w-5" />Planes y operación central</p></div>
      </div>
      <div class="p-7 sm:p-10">
      <div class="mx-auto w-full max-w-md">
      <div class="mb-6 text-center">
        <p class="text-xs font-semibold uppercase tracking-[.24em] text-muted">Dental SaaS</p><h1 class="mt-2 text-3xl font-semibold text-ink">Panel de plataforma</h1><p class="mt-2 text-sm text-muted">Acceso restringido al equipo del SaaS.</p>
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
         class="space-y-4"
        @submit.prevent="entrar"
      >
        <label class="mb-1 block text-sm font-medium text-ink" for="email">Correo</label>
        <input
          id="email"
          v-model="email"
          type="email"
          required
          autocomplete="username"
           class="mb-4 w-full rounded-2xl border border-line bg-background-soft/60 px-4 py-3 text-sm text-ink focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
        <label class="mb-1 block text-sm font-medium text-ink" for="password">Contraseña</label>
        <input
          id="password"
          v-model="password"
          type="password"
          required
          autocomplete="current-password"
           class="w-full rounded-2xl border border-line bg-background-soft/60 px-4 py-3 text-sm text-ink focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
        <AvisoError v-if="plataforma.error" class="mt-3" :mensaje="plataforma.error" />
        <button
          type="submit"
          :disabled="plataforma.cargando"
           class="group mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
        >
           {{ plataforma.cargando ? 'Entrando…' : 'Entrar' }}<ArrowRightIcon v-if="!plataforma.cargando" class="h-4 w-4" />
        </button>
      </form>

      <!-- Paso 2: enrolar TOTP -->
      <div
        v-else-if="plataforma.paso === 'setup'"
        class="rounded-2xl border border-line bg-background-soft/40 p-5"
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
           class="w-full rounded-2xl border border-line bg-background px-3 py-3 text-center font-mono text-lg tracking-widest text-ink focus:outline-none focus:ring-4 focus:ring-primary/10"
          />
          <AvisoError v-if="plataforma.error" class="mt-3" :mensaje="plataforma.error" />
          <button
            type="submit"
            :disabled="plataforma.cargando"
             class="mt-4 w-full rounded-2xl bg-primary px-3 py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
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
         class="rounded-2xl border border-line bg-background-soft/40 p-5"
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
           class="w-full rounded-2xl border border-line bg-background px-3 py-3 text-center font-mono text-lg tracking-widest text-ink focus:outline-none focus:ring-4 focus:ring-primary/10"
        />
        <AvisoError v-if="plataforma.error" class="mt-3" :mensaje="plataforma.error" />
        <button
          type="submit"
          :disabled="plataforma.cargando"
           class="mt-4 w-full rounded-2xl bg-primary px-3 py-3 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-60"
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
      </div></div>
    </div>
  </div>
</template>
