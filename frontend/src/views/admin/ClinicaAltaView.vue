<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import { mensajeDeError } from '../../services/errores'
import { crearClinica, listarPlanes, type Plan } from '../../services/plataforma'

/** Alta completa en una transacción (`POST /platform/tenants`). */
const router = useRouter()
const planes = ref<Plan[]>([])
const cargandoPlanes = ref(true)
const enviando = ref(false)
const error = ref('')

const form = ref({
  slug: '',
  nombre: '',
  razonSocial: '',
  ciudad: '',
  planCodigo: 'clinica',
  sedeNombre: 'Sede principal',
  ownerNombre: '',
  ownerEmail: '',
  ownerPassword: '',
  ownerCop: '',
})

onMounted(async () => {
  try {
    planes.value = await listarPlanes()
    if (planes.value.length > 0 && !planes.value.some((p) => p.codigo === form.value.planCodigo)) {
      form.value.planCodigo = planes.value[0]!.codigo
    }
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar los planes')
  } finally {
    cargandoPlanes.value = false
  }
})

async function guardar(): Promise<void> {
  enviando.value = true
  error.value = ''
  try {
    const creada = await crearClinica({
      slug: form.value.slug.trim(),
      nombre: form.value.nombre.trim(),
      razonSocial: form.value.razonSocial.trim() || undefined,
      ciudad: form.value.ciudad.trim() || undefined,
      planCodigo: form.value.planCodigo,
      sedeNombre: form.value.sedeNombre.trim() || undefined,
      ownerNombre: form.value.ownerNombre.trim(),
      ownerEmail: form.value.ownerEmail.trim(),
      ownerPassword: form.value.ownerPassword,
      ownerCop: form.value.ownerCop.trim() || undefined,
    })
    await router.replace({ name: 'admin-clinica-detalle', params: { id: creada.id } })
  } catch (e) {
    // 409 (slug/email en uso) y 400 (DTO) llegan como mensaje legible.
    error.value = mensajeDeError(e, 'No se pudo crear la clínica')
  } finally {
    enviando.value = false
  }
}

const campo = 'w-full rounded-md border border-line bg-background-soft px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary'
</script>

<template>
  <div class="max-w-2xl">
    <h1 class="mb-4 text-lg font-semibold text-ink">Alta de clínica</h1>

    <CargandoBloque v-if="cargandoPlanes" texto="Cargando planes…" />
    <form v-else class="space-y-4 rounded-lg border border-line bg-background p-5" @submit.prevent="guardar">
      <div>
        <h2 class="text-sm font-medium text-ink">Clínica</h2>
        <div class="mt-2 grid gap-3 sm:grid-cols-2">
          <label class="block text-sm">
            <span class="mb-1 block font-medium text-ink">Slug (minúsculas y guiones)</span>
            <input v-model="form.slug" required minlength="3" maxlength="40" placeholder="clinica-norte" :class="campo" />
          </label>
          <label class="block text-sm">
            <span class="mb-1 block font-medium text-ink">Nombre</span>
            <input v-model="form.nombre" required :class="campo" />
          </label>
          <label class="block text-sm">
            <span class="mb-1 block font-medium text-ink">Razón social (opcional)</span>
            <input v-model="form.razonSocial" :class="campo" />
          </label>
          <label class="block text-sm">
            <span class="mb-1 block font-medium text-ink">Ciudad</span>
            <input v-model="form.ciudad" placeholder="Lima" :class="campo" />
          </label>
          <label class="block text-sm">
            <span class="mb-1 block font-medium text-ink">Plan</span>
            <select v-model="form.planCodigo" required :class="campo">
              <option v-for="p in planes" :key="p.id" :value="p.codigo">
                {{ p.nombre }}
              </option>
            </select>
          </label>
          <label class="block text-sm sm:col-span-2">
            <span class="mb-1 block font-medium text-ink">Sede principal</span>
            <input v-model="form.sedeNombre" :class="campo" />
          </label>
        </div>
      </div>

      <div>
        <h2 class="text-sm font-medium text-ink">Dueño (administrador de la clínica)</h2>
        <div class="mt-2 grid gap-3 sm:grid-cols-2">
          <label class="block text-sm">
            <span class="mb-1 block font-medium text-ink">Nombre</span>
            <input v-model="form.ownerNombre" required :class="campo" />
          </label>
          <label class="block text-sm">
            <span class="mb-1 block font-medium text-ink">Correo</span>
            <input v-model="form.ownerEmail" type="email" required :class="campo" />
          </label>
          <label class="block text-sm">
            <span class="mb-1 block font-medium text-ink">Contraseña (mín. 12)</span>
            <input v-model="form.ownerPassword" type="password" required minlength="12" autocomplete="new-password" :class="campo" />
          </label>
          <label class="block text-sm">
            <span class="mb-1 block font-medium text-ink">COP (opcional)</span>
            <input v-model="form.ownerCop" :class="campo" />
          </label>
        </div>
      </div>

      <AvisoError v-if="error" :mensaje="error" />

      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft"
          @click="router.back()"
        >
          Cancelar
        </button>
        <button
          type="submit"
          :disabled="enviando"
          class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
        >
          {{ enviando ? 'Creando…' : 'Crear clínica' }}
        </button>
      </div>
    </form>
  </div>
</template>
