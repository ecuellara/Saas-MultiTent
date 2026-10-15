<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { CheckIcon } from '@heroicons/vue/24/solid'
import { mensajeDeError } from '../../services/errores'
import { calcularEdad, deInputFecha, paraInputFecha } from '../../services/fechas'
import { actualizarPaciente, crearPaciente, obtenerEstadoUbigeo, type Paciente, type PacienteEntrada } from '../../services/pacientes'
import AvisoError from '../ui/AvisoError.vue'
import FechaNacimientoInput from '../ui/FechaNacimientoInput.vue'
import ModalBase from '../ui/ModalBase.vue'

const props = defineProps<{ paciente: Paciente | null }>()
const emit = defineEmits<{ guardado: [Paciente]; cerrar: [] }>()

interface Campo {
  clave: string
  etiqueta: string
  tipo?: 'text' | 'email' | 'select'
  opciones?: Array<{ valor: string; etiqueta: string }>
  completo?: boolean
  area?: boolean
  inputmode?: 'numeric' | 'tel'
}

const PASOS = [
  { numero: 1, titulo: 'Datos personales', detalle: 'Identificación y datos demográficos' },
  { numero: 2, titulo: 'Contacto y responsable', detalle: 'Canales de contacto y persona de apoyo' },
  { numero: 3, titulo: 'Historia clínica', detalle: 'Antecedentes relevantes para la atención' },
] as const

const CAMPOS_PERSONALES: Campo[] = [
  { clave: 'tipoDoc', etiqueta: 'Tipo de documento', tipo: 'select', opciones: [
    { valor: 'DNI', etiqueta: 'DNI' }, { valor: 'CE', etiqueta: 'Carné de extranjería' }, { valor: 'PASAPORTE', etiqueta: 'Pasaporte' },
  ] },
  { clave: 'numDoc', etiqueta: 'Número de documento', inputmode: 'numeric' },
  { clave: 'nombres', etiqueta: 'Nombres *' }, { clave: 'apellidos', etiqueta: 'Apellidos *' },
  { clave: 'sexo', etiqueta: 'Sexo', tipo: 'select', opciones: [
    { valor: 'F', etiqueta: 'Femenino' }, { valor: 'M', etiqueta: 'Masculino' }, { valor: 'OTRO', etiqueta: 'Otro' },
  ] },
  { clave: 'grupoSanguineo', etiqueta: 'Grupo sanguíneo', tipo: 'select', opciones: ['', 'O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'].map((v) => ({ valor: v, etiqueta: v || 'No especificado' })) },
]
const CAMPOS_CONTACTO: Campo[] = [
  { clave: 'telefono', etiqueta: 'Celular', inputmode: 'tel' }, { clave: 'email', etiqueta: 'Correo electrónico', tipo: 'email' },
  { clave: 'direccion', etiqueta: 'Dirección', completo: true }, { clave: 'ubigeoCodigo', etiqueta: 'Código de ubigeo' },
  { clave: 'contactoEmergenciaNombre', etiqueta: 'Contacto de emergencia' },
  { clave: 'contactoEmergenciaTelefono', etiqueta: 'Celular de emergencia', inputmode: 'tel' },
]
const CAMPOS_REPRESENTANTE: Campo[] = [
  { clave: 'representanteNombre', etiqueta: 'Nombre del representante *' },
  { clave: 'representanteDni', etiqueta: 'DNI del representante *', inputmode: 'numeric' },
  { clave: 'representanteDomicilio', etiqueta: 'Domicilio del representante' },
  { clave: 'representanteParentesco', etiqueta: 'Parentesco' },
]
const CAMPOS_CLINICOS: Campo[] = [
  { clave: 'alergias', etiqueta: 'Alergias', area: true }, { clave: 'enfermedades', etiqueta: 'Enfermedades', area: true },
  { clave: 'medicamentos', etiqueta: 'Medicamentos actuales', area: true }, { clave: 'habitos', etiqueta: 'Hábitos', area: true },
  { clave: 'antecedentes', etiqueta: 'Otros antecedentes', area: true, completo: true },
]
const TODOS = [...CAMPOS_PERSONALES, ...CAMPOS_CONTACTO, ...CAMPOS_REPRESENTANTE, ...CAMPOS_CLINICOS]
const form = reactive<Record<string, string>>({})
const activo = ref(props.paciente?.activo ?? true)
const paso = ref(1)
const guardando = ref(false)
const error = ref('')
const esEdicion = props.paciente !== null

for (const campo of TODOS) {
  const valor = props.paciente ? (props.paciente as unknown as Record<string, unknown>)[campo.clave] : null
  form[campo.clave] = valor == null ? '' : String(valor)
}
form.tipoDoc ||= 'DNI'
form.fechaNac = paraInputFecha(props.paciente?.fechaNac ?? null)

const edad = computed(() => calcularEdad(form.fechaNac ? deInputFecha(form.fechaNac) : null))
const textoEdad = computed(() => edad.value === null ? 'Selecciona una fecha para calcularla' : `${edad.value} año${edad.value === 1 ? '' : 's'}${edad.value < 18 ? ' · menor de edad' : ''}`)
const esMenor = computed(() => edad.value !== null && edad.value < 18)
const camposPaso = computed(() => paso.value === 1 ? CAMPOS_PERSONALES : paso.value === 2 ? CAMPOS_CONTACTO : CAMPOS_CLINICOS)

/**
 * El ubigeo es FK a un catálogo que está VACÍO: con texto libre el guardado
 * fallaría (P2003). Si no hay datos, el campo se deshabilita con el motivo en
 * lugar de ofrecerse. Cuando se cargue el catálogo será un selector, no texto.
 */
const ubigeoVacio = ref(false)
onMounted(async () => {
  try {
    ubigeoVacio.value = (await obtenerEstadoUbigeo()).total === 0
  } catch {
    // Sin estado no se puede asegurar nada: se deja escribir y el backend
    // responde 400 claro si el código no existe.
    ubigeoVacio.value = false
  }
})
function campoDeshabilitado(clave: string): boolean {
  return clave === 'ubigeoCodigo' && ubigeoVacio.value
}

function validarPaso(actual: number): boolean {
  error.value = ''
  if (actual === 1 && (!(form.nombres ?? '').trim() || !(form.apellidos ?? '').trim())) {
    error.value = 'Completa nombres y apellidos para continuar.'
    return false
  }
  if (actual === 2 && esMenor.value && (!(form.representanteNombre ?? '').trim() || !(form.representanteDni ?? '').trim())) {
    error.value = 'Paciente menor de edad: completa nombre y DNI del representante legal.'
    return false
  }
  return true
}
function siguiente(): void { if (validarPaso(paso.value)) paso.value = Math.min(3, paso.value + 1) }
function anterior(): void { error.value = ''; paso.value = Math.max(1, paso.value - 1) }
function irAPaso(destino: number): void {
  if (destino >= paso.value || guardando.value) return
  error.value = ''; paso.value = destino
}
function aPayload(): PacienteEntrada {
  const salida: Record<string, unknown> = {}
  for (const campo of TODOS) {
    const valor = (form[campo.clave] ?? '').trim()
    if (campo.clave === 'nombres' || campo.clave === 'apellidos') salida[campo.clave] = valor
    else if (campo.clave === 'tipoDoc') salida[campo.clave] = valor || 'DNI'
    else salida[campo.clave] = valor || null
  }
  salida.fechaNac = deInputFecha(form.fechaNac ?? '')
  if (!esMenor.value) for (const campo of CAMPOS_REPRESENTANTE) salida[campo.clave] = null
  salida.activo = activo.value
  return salida as PacienteEntrada
}
async function guardar(): Promise<void> {
  if (!validarPaso(1) || !validarPaso(2)) return
  error.value = ''; guardando.value = true
  try {
    const payload = aPayload()
    const resultado = props.paciente ? await actualizarPaciente(props.paciente.id, payload) : await crearPaciente(payload)
    emit('guardado', resultado)
  } catch (e) { error.value = mensajeDeError(e, 'No se pudo guardar el paciente') }
  finally { guardando.value = false }
}
</script>

<template>
  <ModalBase :titulo="esEdicion ? 'Editar paciente' : 'Nuevo paciente'" ancho="lg" @cerrar="emit('cerrar')">
    <div class="mb-5 grid grid-cols-3 gap-2" aria-label="Progreso del formulario">
      <button v-for="item in PASOS" :key="item.numero" type="button" :disabled="item.numero > paso || guardando"
        class="group min-w-0 text-left disabled:cursor-default" @click="irAPaso(item.numero)">
        <div class="mb-2 flex items-center">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition"
            :class="item.numero < paso ? 'border-primary bg-primary text-white' : item.numero === paso ? 'border-primary text-primary ring-4 ring-primary/10' : 'border-line text-muted'">
            <CheckIcon v-if="item.numero < paso" class="h-4 w-4" />
            <span v-else>{{ item.numero }}</span>
          </span>
          <span v-if="item.numero < 3" class="h-px flex-1" :class="item.numero < paso ? 'bg-primary' : 'bg-line'" />
        </div>
        <p class="truncate text-xs font-semibold" :class="item.numero === paso ? 'text-ink' : 'text-muted'">{{ item.titulo }}</p>
      </button>
    </div>

    <div class="rounded-[22px] border border-line bg-background-soft/40 p-4 sm:p-5">
      <div class="mb-4">
        <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-secondary">Paso {{ paso }} de 3</p>
        <h3 class="mt-1 text-lg font-semibold text-ink">{{ PASOS[paso - 1]!.titulo }}</h3>
        <p class="text-sm text-muted">{{ PASOS[paso - 1]!.detalle }}</p>
      </div>

      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="paso < 3 ? siguiente() : guardar()">
        <template v-for="campo in camposPaso" :key="campo.clave">
          <div :class="campo.completo && 'sm:col-span-2'">
            <label class="mb-1 block text-xs font-medium text-ink" :for="`paciente-${campo.clave}`">{{ campo.etiqueta }}</label>
            <select v-if="campo.tipo === 'select'" :id="`paciente-${campo.clave}`" v-model="form[campo.clave]"
              class="w-full rounded-xl border border-line bg-background px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary">
              <option v-if="campo.clave !== 'tipoDoc'" value="">—</option>
              <option v-for="opcion in campo.opciones" :key="opcion.valor" :value="opcion.valor">{{ opcion.etiqueta }}</option>
            </select>
            <textarea v-else-if="campo.area" :id="`paciente-${campo.clave}`" v-model="form[campo.clave]" rows="3"
              class="w-full resize-none rounded-xl border border-line bg-background px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary" />
            <input v-else :id="`paciente-${campo.clave}`" v-model="form[campo.clave]" :type="campo.tipo ?? 'text'" :inputmode="campo.inputmode"
              :disabled="campoDeshabilitado(campo.clave)" :placeholder="campo.clave === 'ubigeoCodigo' && ubigeoVacio ? 'Catálogo sin cargar' : undefined"
              class="w-full rounded-xl border border-line bg-background px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50" />
            <p v-if="campo.clave === 'ubigeoCodigo' && ubigeoVacio" class="mt-1 text-xs text-muted">
              Catálogo de ubigeos sin cargar: el campo queda deshabilitado hasta que se
              carguen los datos oficiales (no se acepta texto libre).
            </p>
          </div>
        </template>

        <div v-if="paso === 1" class="sm:col-span-2">
          <label class="mb-1 block text-xs font-medium text-ink" for="paciente-fechaNac">Fecha de nacimiento</label>
          <FechaNacimientoInput id="paciente-fechaNac" v-model="form.fechaNac" />
          <p class="mt-1 text-xs" :class="esMenor ? 'font-semibold text-warning' : 'text-muted'">Edad: {{ textoEdad }}</p>
        </div>

        <section v-if="paso === 2" class="sm:col-span-2 rounded-2xl border p-4"
          :class="esMenor ? 'border-warning/40 bg-warning/10' : 'border-line bg-background'">
          <div class="mb-3">
            <h4 class="text-xs font-semibold uppercase tracking-[0.16em]" :class="esMenor ? 'text-warning' : 'text-muted'">Representante legal</h4>
            <p class="mt-1 text-xs text-muted">{{ esMenor ? 'Obligatorio: el paciente es menor de edad.' : edad === null ? 'Se habilita al indicar una fecha de nacimiento menor de 18 años.' : 'No requerido para pacientes mayores de edad.' }}</p>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div v-for="campo in CAMPOS_REPRESENTANTE" :key="campo.clave">
              <label class="mb-1 block text-xs font-medium text-ink" :for="`paciente-${campo.clave}`">{{ campo.etiqueta }}</label>
              <input :id="`paciente-${campo.clave}`" v-model="form[campo.clave]" :disabled="!esMenor" :inputmode="campo.inputmode"
                class="w-full rounded-xl border border-line bg-background px-3 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50" />
            </div>
          </div>
        </section>

        <label v-if="paso === 3" class="flex items-center gap-2 rounded-xl border border-line bg-background px-3 py-2.5 text-sm text-ink sm:col-span-2">
          <input v-model="activo" type="checkbox" class="h-4 w-4 rounded border-line" />Paciente activo
        </label>
        <button type="submit" class="sr-only">Continuar</button>
      </form>
    </div>

    <AvisoError v-if="error" class="mt-4" :mensaje="error" />

    <template #pie>
      <div class="flex items-center justify-between gap-3">
        <button type="button" class="rounded-full px-3 py-2 text-sm text-muted hover:bg-background-soft hover:text-ink" :disabled="guardando" @click="emit('cerrar')">Cancelar</button>
        <div class="flex gap-2">
          <button v-if="paso > 1" type="button" class="rounded-full border border-line bg-background px-4 py-2 text-sm font-semibold text-ink hover:bg-background-soft disabled:opacity-60" :disabled="guardando" @click="anterior">Anterior</button>
          <button v-if="paso < 3" type="button" class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark" @click="siguiente">Continuar</button>
          <button v-else type="button" class="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-dark disabled:opacity-60" :disabled="guardando" @click="guardar">{{ guardando ? 'Guardando…' : 'Guardar paciente' }}</button>
        </div>
      </div>
    </template>
  </ModalBase>
</template>
