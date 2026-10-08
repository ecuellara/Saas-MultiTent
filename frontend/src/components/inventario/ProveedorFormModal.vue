<script setup lang="ts">
import { reactive, ref } from 'vue'
import {
  actualizarProveedor,
  crearProveedor,
  type Proveedor,
} from '../../services/proveedores'
import { mensajeDeError } from '../../services/errores'
import AvisoError from '../ui/AvisoError.vue'
import ModalBase from '../ui/ModalBase.vue'

const props = defineProps<{
  /** Si viene, el formulario edita; si no, crea. */
  proveedor?: Proveedor | null
}>()

const emit = defineEmits<{ guardado: [Proveedor]; cerrar: [] }>()

const esEdicion = !!props.proveedor

const form = reactive({
  nombre: props.proveedor?.nombre ?? '',
  ruc: props.proveedor?.ruc ?? '',
  contacto: props.proveedor?.contacto ?? '',
  telefono: props.proveedor?.telefono ?? '',
  email: props.proveedor?.email ?? '',
  direccion: props.proveedor?.direccion ?? '',
})

const guardando = ref(false)
const error = ref('')

function payload(): {
  nombre: string
  ruc?: string
  contacto?: string
  telefono?: string
  email?: string
  direccion?: string
} {
  const recortar = (v: string): string | undefined => {
    const t = v.trim()
    return t === '' ? undefined : t
  }
  return {
    nombre: form.nombre.trim(),
    ruc: recortar(form.ruc),
    contacto: recortar(form.contacto),
    telefono: recortar(form.telefono),
    email: recortar(form.email),
    direccion: recortar(form.direccion),
  }
}

async function guardar(): Promise<void> {
  error.value = ''
  if (!form.nombre.trim()) {
    error.value = 'El nombre es obligatorio'
    return
  }
  if (form.email.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) {
    error.value = 'El correo no tiene un formato válido'
    return
  }
  guardando.value = true
  try {
    const dto = payload()
    const guardado = esEdicion
      ? await actualizarProveedor(props.proveedor!.id, dto)
      : await crearProveedor(dto)
    emit('guardado', guardado)
  } catch (e) {
    // Aquí llegan las reglas del backend: RUC duplicado (409) y validación (400).
    error.value = mensajeDeError(e, 'No se pudo guardar el proveedor')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalBase :titulo="esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'" ancho="sm" @cerrar="emit('cerrar')">
    <AvisoError v-if="error" class="mb-4" :mensaje="error" />

    <form class="grid gap-3" @submit.prevent="guardar">
      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="prov-nombre">Nombre</label>
        <input
          id="prov-nombre"
          v-model="form.nombre"
          type="text"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="prov-ruc">RUC</label>
        <input
          id="prov-ruc"
          v-model="form.ruc"
          type="text"
          inputmode="numeric"
          placeholder="20123456789"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="prov-contacto">Contacto</label>
          <input
            id="prov-contacto"
            v-model="form.contacto"
            type="text"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="prov-tel">Teléfono</label>
          <input
            id="prov-tel"
            v-model="form.telefono"
            type="tel"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="prov-email">Correo</label>
        <input
          id="prov-email"
          v-model="form.email"
          type="email"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div>
        <label class="mb-1 block text-xs font-medium text-ink" for="prov-dir">Dirección</label>
        <input
          id="prov-dir"
          v-model="form.direccion"
          type="text"
          class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div class="flex justify-end gap-2">
        <button
          type="button"
          class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
          :disabled="guardando"
          @click="emit('cerrar')"
        >
          Cancelar
        </button>
        <button
          type="submit"
          class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
          :disabled="guardando"
        >
          {{ guardando ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear proveedor' }}
        </button>
      </div>
    </form>
  </ModalBase>
</template>
