<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import AvisoError from '../components/ui/AvisoError.vue'
import CargandoBloque from '../components/ui/CargandoBloque.vue'
import {
  actualizarConfiguracion,
  DIAS_SEMANA,
  obtenerConfiguracion,
  resumirHorario,
  type Configuracion,
  type Descanso,
  type DiaSemana,
  type Horario,
} from '../services/configuracion'
import { mensajeDeError } from '../services/errores'
import { useSessionStore } from '../stores/session'

const sesion = useSessionStore()

const config = ref<Configuracion | null>(null)
const cargando = ref(true)
const guardando = ref(false)
const error = ref('')
const guardadoOk = ref(false)

const datos = reactive({
  nombre: '',
  ruc: '',
  direccion: '',
  telefono: '',
  email: '',
  ciudad: '',
  logoUrl: '',
})

type FilaHorario = { abierto: boolean; inicio: string; fin: string }
const horario = reactive<Record<DiaSemana, FilaHorario>>({
  dom: { abierto: false, inicio: '09:00', fin: '19:00' },
  lun: { abierto: true, inicio: '09:00', fin: '19:00' },
  mar: { abierto: true, inicio: '09:00', fin: '19:00' },
  mie: { abierto: true, inicio: '09:00', fin: '19:00' },
  jue: { abierto: true, inicio: '09:00', fin: '19:00' },
  vie: { abierto: true, inicio: '09:00', fin: '19:00' },
  sab: { abierto: true, inicio: '09:00', fin: '13:00' },
})

const descansos = ref<Descanso[]>([])
const nuevoDescanso = reactive({ desde: '', hasta: '', motivo: '' })

const puedeEditar = computed(() => sesion.puede('sedes.manage'))

const resumen = computed(() => (config.value ? resumirHorario(config.value.horario) : ''))

function aFormulario(c: Configuracion): void {
  datos.nombre = c.nombre ?? ''
  datos.ruc = c.ruc ?? ''
  datos.direccion = c.direccion ?? ''
  datos.telefono = c.telefono ?? ''
  datos.email = c.email ?? ''
  datos.ciudad = c.ciudad ?? ''
  datos.logoUrl = c.logoUrl ?? ''
  for (const { clave } of DIAS_SEMANA) {
    const f = c.horario?.[clave] ?? null
    horario[clave] = f
      ? { abierto: true, inicio: f.inicio, fin: f.fin }
      : { abierto: false, inicio: '09:00', fin: '19:00' }
  }
  descansos.value = (c.descansos ?? []).map((d) => ({ ...d }))
}

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  guardadoOk.value = false
  try {
    const c = await obtenerConfiguracion()
    config.value = c
    aFormulario(c)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar la configuración')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

function agregarDescanso(): void {
  error.value = ''
  if (!nuevoDescanso.desde) {
    error.value = 'El descanso necesita al menos la fecha de inicio'
    return
  }
  descansos.value.push({
    desde: nuevoDescanso.desde,
    ...(nuevoDescanso.hasta ? { hasta: nuevoDescanso.hasta } : {}),
    ...(nuevoDescanso.motivo.trim() ? { motivo: nuevoDescanso.motivo.trim() } : {}),
  })
  nuevoDescanso.desde = ''
  nuevoDescanso.hasta = ''
  nuevoDescanso.motivo = ''
}

function quitarDescanso(i: number): void {
  descansos.value.splice(i, 1)
}

function etiquetaDescanso(d: Descanso): string {
  const rango = d.hasta && d.hasta !== d.desde ? `${d.desde} → ${d.hasta}` : d.desde
  return d.motivo ? `${rango} · ${d.motivo}` : rango
}

async function guardar(): Promise<void> {
  error.value = ''
  guardadoOk.value = false
  if (!datos.nombre.trim()) {
    error.value = 'El nombre es obligatorio'
    return
  }
  const h: Horario = {} as Horario
  for (const { clave } of DIAS_SEMANA) {
    const f = horario[clave]!
    h[clave] = f.abierto ? { inicio: f.inicio, fin: f.fin } : null
  }
  guardando.value = true
  try {
    const c = await actualizarConfiguracion({
      nombre: datos.nombre.trim(),
      ruc: datos.ruc.trim() || undefined,
      direccion: datos.direccion.trim() || undefined,
      telefono: datos.telefono.trim() || undefined,
      email: datos.email.trim() || undefined,
      ciudad: datos.ciudad.trim() || undefined,
      logoUrl: datos.logoUrl.trim() || undefined,
      horario: h,
      descansos: descansos.value,
    })
    config.value = c
    aFormulario(c)
    guardadoOk.value = true
  } catch (e) {
    // Aquí llegan las reglas del DTO: días mal escritos, horas sin cero
    // delante, inicio >= fin, descansos con fechas imposibles.
    error.value = mensajeDeError(e, 'No se pudo guardar la configuración')
  } finally {
    guardando.value = false
  }
}

const campo = 'w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60'
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <h2 class="text-lg font-semibold text-ink">Configuración</h2>

    <CargandoBloque v-if="cargando" texto="Cargando configuración…" />
    <AvisoError v-else-if="error && !config" :mensaje="error" />

    <template v-else-if="config">
      <p v-if="!puedeEditar" class="mt-3 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning" role="note">
        Solo lectura: tu rol no tiene permiso de gestión, así que ves los datos
        pero no puedes cambiarlos. Pide a un administrador que los actualice.
      </p>

      <AvisoError v-if="error" class="mt-3" :mensaje="error" />
      <p v-if="guardadoOk" class="mt-3 rounded-md bg-success/10 px-3 py-2 text-xs text-success" role="status">
        Guardado. Horario resultante: {{ resumen }}
      </p>

      <fieldset :disabled="!puedeEditar" class="mt-4 space-y-4">
        <section class="rounded-lg border border-line bg-background p-4">
          <h3 class="text-sm font-medium text-ink">Datos de la clínica</h3>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <label class="block text-sm">
              <span class="mb-1 block font-medium text-ink">Nombre</span>
              <input v-model="datos.nombre" type="text" :class="campo" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium text-ink">RUC</span>
              <input v-model="datos.ruc" type="text" inputmode="numeric" :class="campo" />
            </label>
            <label class="block text-sm sm:col-span-2">
              <span class="mb-1 block font-medium text-ink">Dirección</span>
              <input v-model="datos.direccion" type="text" :class="campo" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium text-ink">Teléfono</span>
              <input v-model="datos.telefono" type="tel" :class="campo" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium text-ink">Correo</span>
              <input v-model="datos.email" type="email" :class="campo" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium text-ink">Ciudad</span>
              <input v-model="datos.ciudad" type="text" :class="campo" />
            </label>
            <label class="block text-sm">
              <span class="mb-1 block font-medium text-ink">Logo (URL)</span>
              <input v-model="datos.logoUrl" type="url" placeholder="https://…" :class="campo" />
            </label>
          </div>
        </section>

        <section class="rounded-lg border border-line bg-background p-4">
          <h3 class="text-sm font-medium text-ink">Horario de atención</h3>
          <p class="mt-1 text-xs text-muted">Las horas usan el formato de 24 h que valida la agenda.</p>
          <ul class="mt-3 space-y-2">
            <li v-for="{ clave, etiqueta } in DIAS_SEMANA" :key="clave" class="flex flex-wrap items-center gap-2">
              <label class="flex w-28 cursor-pointer items-center gap-2 text-sm text-ink">
                <input v-model="horario[clave]!.abierto" type="checkbox" class="accent-primary" />
                {{ etiqueta }}
              </label>
              <input
                v-model="horario[clave]!.inicio"
                type="time"
                :disabled="!horario[clave]!.abierto"
                aria-label="Hora de inicio"
                class="rounded-md border border-line bg-background-soft px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40"
              />
              <span class="text-xs text-muted">a</span>
              <input
                v-model="horario[clave]!.fin"
                type="time"
                :disabled="!horario[clave]!.abierto"
                aria-label="Hora de fin"
                class="rounded-md border border-line bg-background-soft px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-40"
              />
            </li>
          </ul>
        </section>

        <section class="rounded-lg border border-line bg-background p-4">
          <h3 class="text-sm font-medium text-ink">Descansos</h3>
          <ul v-if="descansos.length > 0" class="mt-3 space-y-1.5">
            <li
              v-for="(d, i) in descansos"
              :key="`${d.desde}-${i}`"
              class="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-1.5 text-sm"
            >
              <span class="text-ink">{{ etiquetaDescanso(d) }}</span>
              <button
                type="button"
                class="rounded px-2 py-0.5 text-xs text-error hover:bg-error/10 disabled:opacity-40"
                :disabled="!puedeEditar"
                @click="quitarDescanso(i)"
              >
                Quitar
              </button>
            </li>
          </ul>
          <p v-else class="mt-2 text-xs text-muted">Sin descansos programados.</p>
          <div class="mt-3 grid gap-2 sm:grid-cols-[auto_auto_1fr_auto]">
            <input
              v-model="nuevoDescanso.desde"
              type="date"
              aria-label="Desde"
              class="rounded-md border border-line bg-background-soft px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
              :disabled="!puedeEditar"
            />
            <input
              v-model="nuevoDescanso.hasta"
              type="date"
              aria-label="Hasta (opcional)"
              class="rounded-md border border-line bg-background-soft px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
              :disabled="!puedeEditar"
            />
            <input
              v-model="nuevoDescanso.motivo"
              type="text"
              placeholder="Motivo (opcional)"
              class="rounded-md border border-line bg-background-soft px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
              :disabled="!puedeEditar"
            />
            <button
              type="button"
              class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
              :disabled="!puedeEditar"
              @click="agregarDescanso"
            >
              Añadir
            </button>
          </div>
        </section>

        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
            :disabled="!puedeEditar || cargando"
            @click="cargar"
          >
            Recargar
          </button>
          <button
            type="button"
            class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
            :disabled="!puedeEditar || guardando"
            @click="guardar"
          >
            {{ guardando ? 'Guardando…' : 'Guardar cambios' }}
          </button>
        </div>
      </fieldset>
    </template>
  </div>
</template>
