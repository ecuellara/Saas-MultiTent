<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
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

function alExpirar(): void {
  sesion.limpiar()
  if (router.currentRoute.value.name !== 'login') {
    void router.replace({ name: 'login', query: { expirada: '1' } })
  }
}

onMounted(() => window.addEventListener('sesion:expirada', alExpirar))
onUnmounted(() => window.removeEventListener('sesion:expirada', alExpirar))
</script>

<template>
  <RouterView :key="$route.name === 'login' ? 'login' : 'app'" />
</template>
