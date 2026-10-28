<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRightIcon, BuildingOffice2Icon, CalendarDaysIcon, ClipboardDocumentListIcon } from '@heroicons/vue/24/outline'
import ThemeToggle from '../../components/ui/ThemeToggle.vue'
import { aplicarColoresTenant, leerCacheMarca, urlLogoPublico } from '../../services/branding'
import { useSessionStore } from '../../stores/session'
const sesion = useSessionStore(); const router = useRouter(); const route = useRoute()
const marcaLogin = leerCacheMarca()
const logoLogin = marcaLogin?.tieneLogo ? urlLogoPublico(marcaLogin.slug, marcaLogin.version) : ''
aplicarColoresTenant(marcaLogin?.colores)
const email = ref(''); const password = ref(''); const focusEmail = ref(false); const focusPassword = ref(false)
const expirada = computed(() => route.query.expirada === '1')
async function entrar(): Promise<void> { if (await sesion.iniciarSesion(email.value.trim(), password.value)) await router.replace(typeof route.query.destino === 'string' ? route.query.destino : '/') }
</script>
<template>
  <div class="login-shell relative min-h-screen overflow-hidden px-4 py-8">
    <img src="/login-bg.svg" alt="" class="absolute inset-0 h-full w-full object-cover opacity-45 dark:opacity-25" />
    <div class="absolute inset-0 bg-[linear-gradient(180deg,rgba(5,18,33,.22),rgba(5,18,33,.12))]" />
    <div class="absolute right-4 top-4 z-10"><ThemeToggle compacto /></div>
    <div class="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center">
      <div class="grid w-full overflow-hidden rounded-[2rem] border border-white/15 bg-background/95 shadow-[0_40px_120px_-60px_rgba(7,86,163,.75)] backdrop-blur-xl md:grid-cols-2">
        <div class="relative flex flex-col justify-between overflow-hidden p-7 text-white sm:p-9">
          <div class="absolute inset-0 bg-[linear-gradient(160deg,rgba(7,86,163,.94),rgba(18,184,206,.8))]" />
          <div class="relative z-10">
            <div class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[.22em]">Gestión clínica</div>
            <div class="mt-7 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white/15"><img v-if="logoLogin" :src="logoLogin" class="h-full w-full object-contain" alt="Logo de la clínica" /><img v-else src="/favicon.svg" class="h-10 w-10" alt="" /></div>
            <h2 class="mt-5 text-3xl font-semibold tracking-tight">Una plataforma para tus clínicas</h2>
            <p class="mt-3 max-w-md text-sm leading-6 text-white/80">Agenda, pacientes, operación clínica y cobros en un panel seguro, claro y multi-clínica.</p>
          </div>
          <ul class="relative z-10 mt-8 space-y-3 text-sm text-white/90">
            <li class="flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-2"><CalendarDaysIcon class="h-5 w-5" />Agenda y equipo organizados</li>
            <li class="flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-2"><ClipboardDocumentListIcon class="h-5 w-5" />Ficha clínica y odontograma</li>
            <li class="flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-2"><BuildingOffice2Icon class="h-5 w-5" />Acceso a todas tus clínicas</li>
          </ul>
        </div>
        <div class="flex items-center bg-background p-7 sm:p-10">
          <div class="mx-auto w-full max-w-md">
            <p class="text-xs font-semibold uppercase tracking-[.24em] text-muted">Acceso seguro</p>
            <h1 class="mt-2 text-3xl font-semibold tracking-tight text-ink">Bienvenido</h1>
            <p class="mt-2 text-sm text-muted">Ingresa con tu cuenta para continuar.</p>
            <p v-if="expirada" class="mt-5 rounded-2xl border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">Tu sesión expiró. Vuelve a entrar.</p>
            <form class="mt-7 space-y-5" @submit.prevent="entrar">
              <label class="relative block"><span class="absolute z-10 px-1 text-sm text-muted transition-all" :class="focusEmail || email ? '-top-2 left-3 bg-background text-xs text-primary' : 'left-4 top-4'">Correo</span><input v-model="email" type="email" required autocomplete="username" class="w-full rounded-2xl border border-line bg-background px-4 py-3.5 text-ink outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" @focus="focusEmail=true" @blur="focusEmail=false" /></label>
              <label class="relative block"><span class="absolute z-10 px-1 text-sm text-muted transition-all" :class="focusPassword || password ? '-top-2 left-3 bg-background text-xs text-primary' : 'left-4 top-4'">Contraseña</span><input v-model="password" type="password" required autocomplete="current-password" class="w-full rounded-2xl border border-line bg-background px-4 py-3.5 text-ink outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10" @focus="focusPassword=true" @blur="focusPassword=false" /></label>
              <p v-if="sesion.error" class="rounded-2xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-error">{{ sesion.error }}</p>
              <button type="submit" :disabled="sesion.cargando" class="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3.5 font-semibold text-white shadow-[0_14px_30px_-16px_rgba(7,86,163,.8)] transition hover:-translate-y-0.5 hover:bg-primary-dark disabled:opacity-60">{{ sesion.cargando ? 'Entrando…' : 'Entrar a mi panel' }}<ArrowRightIcon v-if="!sesion.cargando" class="h-4 w-4 group-hover:translate-x-0.5" /></button>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped>.login-shell{background:linear-gradient(135deg,#0b5aa8,#0f6fc7 38%,#0a3e7a)}.dark .login-shell{background:linear-gradient(135deg,#07131d,#0b1b28 38%,#0f2437)}</style>
