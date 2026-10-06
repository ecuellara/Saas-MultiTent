<script setup lang="ts">
import { reactive, ref } from 'vue'
import { mensajeDeError } from '../../services/errores'
import {
  actualizarPaciente,
  crearPaciente,
  deInputFecha,
  paraInputFecha,
  type Paciente,
  type PacienteEntrada,
} from '../../services/pacientes'
import AvisoError from '../ui/AvisoError.vue'
import ModalBase from '../ui/ModalBase.vue'

/**
 * Formulario de paciente (alta y edición).
 *
 * Los campos se declaran como datos y se pintan en bucle: la ficha tiene más de
 * veinte campos y repetir el `v-model` de cada uno era la vía directa a que unos
 * cuantos se quedaran fuera del formulario sin que nadie lo notara.
 */
const props = defineProps<{ paciente: Paciente | null }>()

const emit = defineEmits<{ guardado: [Paciente]; cerrar: [] }>()

interface Campo {
  clave: string
  etiqueta: string
  tipo?: 'text' | 'date' | 'email' | 'select'
  opciones?: string[]
  /** Ocupa las dos columnas. */
  completo?: boolean
  area?: boolean
}

const SECCIONES: Array<{ titulo: string; campos: Campo[] }> = [
  {
    titulo: 'Identificación',
    campos: [
      {
        clave: 'tipoDoc',
        etiqueta: 'Tipo de documento',
        tipo: 'select',
        opciones: ['DNI', 'CE', 'PASAPORTE'],
      },
      { clave: 'numDoc', etiqueta: 'Número' },
      { clave: 'nombres', etiqueta: 'Nombres' },
      { clave: 'apellidos', etiqueta: 'Apellidos' },
      { clave: 'fechaNac', etiqueta: 'Fecha de nacimiento', tipo: 'date' },
      { clave: 'sexo', etiqueta: 'Sexo', tipo: 'select', opciones: ['F', 'M', 'OTRO'] },
      { clave: 'grupoSanguineo', etiqueta: 'Grupo sanguíneo' },
    ],
  },
  {
    titulo: 'Contacto',
    campos: [
      { clave: 'telefono', etiqueta: 'Teléfono' },
      { clave: 'email', etiqueta: 'Correo', tipo: 'email' },
      { clave: 'direccion', etiqueta: 'Dirección', completo: true, area: true },
      { clave: 'ubigeoCodigo', etiqueta: 'Código de ubigeo' },
    ],
  },
  {
    titulo: 'Contacto de emergencia',
    campos: [
      { clave: 'contactoEmergenciaNombre', etiqueta: 'Nombre' },
      { clave: 'contactoEmergenciaTelefono', etiqueta: 'Teléfono' },
    ],
  },
  {
    titulo: 'Representante legal',
    campos: [
      { clave: 'representanteNombre', etiqueta: 'Nombre' },
      { clave: 'representanteDni', etiqueta: 'DNI' },
      { clave: 'representanteParentesco', etiqueta: 'Parentesco' },
      { clave: 'representanteDomicilio', etiqueta: 'Domicilio', completo: true },
    ],
  },
  {
    titulo: 'Antecedentes clínicos',
    campos: [
      { clave: 'alergias', etiqueta: 'Alergias', completo: true, area: true },
      { clave: 'enfermedades', etiqueta: 'Enfermedades', completo: true, area: true },
      { clave: 'medicamentos', etiqueta: 'Medicamentos', completo: true, area: true },
      { clave: 'habitos', etiqueta: 'Hábitos', completo: true, area: true },
      { clave: 'antecedentes', etiqueta: 'Antecedentes', completo: true, area: true },
    ],
  },
]

const TODAS = SECCIONES.flatMap((s) => s.campos)

const form = reactive<Record<string, string>>({})
const activo = ref(true)
const guardando = ref(false)
const error = ref('')

function inicializar(p: Paciente | null): void {
  for (const c of TODAS) {
    const valor = p ? (p as unknown as Record<string, unknown>)[c.clave] : null
    if (c.clave === 'fechaNac') {
      form[c.clave] = paraInputFecha(valor as string | null)
    } else {
      form[c.clave] = valor === null || valor === undefined ? '' : String(valor)
    }
  }
  activo.value = p?.activo ?? true
}

inicializar(props.paciente)

const esEdicion = props.paciente !== null

function aPayload(): PacienteEntrada {
  const salida: Record<string, unknown> = {}
  for (const c of TODAS) {
    const valor = (form[c.clave] ?? '').trim()
    if (c.clave === 'nombres' || c.clave === 'apellidos') {
      salida[c.clave] = valor
      continue
    }
    if (c.clave === 'tipoDoc') {
      salida[c.clave] = valor || 'DNI'
      continue
    }
    if (c.clave === 'fechaNac') {
      // El input da `aaaa-mm-dd`, pero Prisma rechaza esa forma en un `DateTime`:
      // hay que enviar el instante completo (medianoche UTC).
      salida[c.clave] = deInputFecha(valor)
      continue
    }
    // Vacío → `null`: el DTO usa `@IsOptional()` (que ignora `null`) y así no se
    // guardan cadenas vacías que después ensucian la ficha.
    salida[c.clave] = valor === '' ? null : valor
  }
  salida.activo = activo.value
  return salida as PacienteEntrada
}

async function guardar(): Promise<void> {
  error.value = ''
  if (!(form.nombres ?? '').trim() || !(form.apellidos ?? '').trim()) {
    error.value = 'Nombres y apellidos son obligatorios'
    return
  }
  guardando.value = true
  try {
    const payload = aPayload()
    const guardado = props.paciente
      ? await actualizarPaciente(props.paciente.id, payload)
      : await crearPaciente(payload)
    emit('guardado', guardado)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo guardar el paciente')
  } finally {
    guardando.value = false
  }
}
</script>

<template>
  <ModalBase
    :titulo="esEdicion ? 'Editar paciente' : 'Nuevo paciente'"
    ancho="lg"
    @cerrar="emit('cerrar')"
  >
    <form class="space-y-5" @submit.prevent="guardar">
      <section v-for="seccion in SECCIONES" :key="seccion.titulo">
        <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          {{ seccion.titulo }}
        </h3>
        <div class="grid gap-3 sm:grid-cols-2">
          <div v-for="campo in seccion.campos" :key="campo.clave" :class="campo.completo && 'sm:col-span-2'">
            <label class="mb-1 block text-xs font-medium text-ink" :for="`campo-${campo.clave}`">
              {{ campo.etiqueta }}
            </label>

            <select
              v-if="campo.tipo === 'select'"
              :id="`campo-${campo.clave}`"
              v-model="form[campo.clave]"
              class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">—</option>
              <option v-for="op in campo.opciones" :key="op" :value="op">{{ op }}</option>
            </select>

            <textarea
              v-else-if="campo.area"
              :id="`campo-${campo.clave}`"
              v-model="form[campo.clave]"
              rows="2"
              class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            />

            <input
              v-else
              :id="`campo-${campo.clave}`"
              v-model="form[campo.clave]"
              :type="campo.tipo ?? 'text'"
              class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>
      </section>

      <label class="flex items-center gap-2 text-sm text-ink">
        <input v-model="activo" type="checkbox" class="h-4 w-4 rounded border-line" />
        Paciente activo
      </label>

      <AvisoError v-if="error" :mensaje="error" />
    </form>

    <template #pie>
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
          type="button"
          class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
          :disabled="guardando"
          @click="guardar"
        >
          {{ guardando ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
    </template>
  </ModalBase>
</template>
