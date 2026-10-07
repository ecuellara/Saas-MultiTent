<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { usePlataformaStore } from './stores/plataforma'
import { useSessionStore } from './stores/session'

/**
 * Raíz de la aplicación.
 *
 * Su única responsabilidad además de pintar la ruta es reaccionar a la
 * EXPIRACIÓN de la sesión: el interceptor de axios avisa por evento en vez de
 * forzar `window.location.href`, que recargaba la página y hacía perder el
 * formulario a medio llenar.
 */
const router = useRouter()
const sesion = useSessionStore()
const plataforma = usePlataformaStore()

function alExpirar(): void {
  sesion.limpiar()
  if (router.currentRoute.value.name !== 'login') {
    void router.replace({ name: 'login', query: { expirada: '1' } })
  }
}

/**
 * Expiración de PLATAFORMA: solo redirige si se está en `/admin` (el evento
 * solo lo emite el cliente de plataforma, pero la guarda es barata).
 */
function alExpirarPlataforma(): void {
  plataforma.limpiar()
  if (router.currentRoute.value.path.startsWith('/admin') && router.currentRoute.value.name !== 'admin-login') {
    void router.replace({ name: 'admin-login', query: { expirada: '1' } })
  }
}

onMounted(() => {
  window.addEventListener('sesion:expirada', alExpirar)
  window.addEventListener('plataforma:expirada', alExpirarPlataforma)
})
onUnmounted(() => {
  window.removeEventListener('sesion:expirada', alExpirar)
  window.removeEventListener('plataforma:expirada', alExpirarPlataforma)
})
</script>

<template>
  <RouterView :key="$route.name === 'login' ? 'login' : 'app'" />
</template>
