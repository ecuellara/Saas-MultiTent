<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AvisoError from '../../components/ui/AvisoError.vue'
import CargandoBloque from '../../components/ui/CargandoBloque.vue'
import EstadoVacio from '../../components/ui/EstadoVacio.vue'
import ModalBase from '../../components/ui/ModalBase.vue'
import {
  agruparPermisosPorRecurso,
  asignarPermisos,
  codigosDeRol,
  crearRol,
  listarCatalogoPermisos,
  listarRoles,
  type Permiso,
  type Rol,
} from '../../services/roles'
import { listarSedes, type Sede } from '../../services/sedes'
import {
  crearUsuario,
  etiquetaEstadoUsuario,
  listarUsuarios,
  type UsuarioEquipo,
} from '../../services/usuarios'
import { mensajeDeError } from '../../services/errores'
import { useSessionStore } from '../../stores/session'
import { UserGroupIcon } from '@heroicons/vue/24/outline'
import ModuloHero from '../../components/ui/ModuloHero.vue'

/**
 * Pantalla de usuarios y roles.
 *
 * La ruta exige `users.manage`, pero la sección de roles (listar, crear y
 * editar permisos) exige `roles.manage`: se oculta sin él. La interfaz solo
 * oculta; cada endpoint rechaza en el servidor igualmente.
 */
const sesion = useSessionStore()

const usuarios = ref<UsuarioEquipo[]>([])
const roles = ref<Rol[]>([])
const sedes = ref<Sede[]>([])
const catalogo = ref<Permiso[]>([])
const cargando = ref(true)
const error = ref('')
const busqueda = ref('')

/** Sin `roles.manage` no hay de dónde elegir rol: el alta también se oculta. */
const puedeRoles = computed(() => sesion.puede('roles.manage'))

const filtrados = computed(() => {
  const q = busqueda.value.trim().toLowerCase()
  if (!q) return usuarios.value
  return usuarios.value.filter(
    (u) =>
      u.nombre.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.memberships[0]?.role.nombre ?? '').toLowerCase().includes(q),
  )
})

const gruposPermisos = computed(() => agruparPermisosPorRecurso(catalogo.value))

async function cargar(): Promise<void> {
  cargando.value = true
  error.value = ''
  try {
    const base: Array<Promise<unknown>> = [listarUsuarios(), listarSedes()]
    if (puedeRoles.value) base.push(listarRoles(), listarCatalogoPermisos())
    const [us, se, ro, cat] = await Promise.all(base)
    usuarios.value = us as UsuarioEquipo[]
    sedes.value = se as Sede[]
    if (ro && cat) {
      roles.value = ro as Rol[]
      catalogo.value = cat as Permiso[]
    }
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo cargar el equipo')
  } finally {
    cargando.value = false
  }
}

onMounted(cargar)

// ------------------------------------------------------------ alta de usuario

const modalAlta = ref(false)
const guardandoAlta = ref(false)
const errorAlta = ref('')
const verClave = ref(false)
const formAlta = ref({ email: '', nombre: '', password: '', roleId: '', sedeId: '' })

function abrirAlta(): void {
  formAlta.value = { email: '', nombre: '', password: '', roleId: '', sedeId: '' }
  errorAlta.value = ''
  verClave.value = false
  modalAlta.value = true
}

async function guardarAlta(): Promise<void> {
  errorAlta.value = ''
  const f = formAlta.value
  if (!f.email.trim() || !f.nombre.trim() || !f.password || !f.roleId || !f.sedeId) {
    errorAlta.value = 'Completa todos los campos'
    return
  }
  if (f.password.length < 12) {
    errorAlta.value = 'La contraseña debe tener al menos 12 caracteres'
    return
  }
  guardandoAlta.value = true
  try {
    // La contraseña viaja SOLO en este POST: no se guarda en ningún estado
    // tras el alta (el formulario se descarta al cerrar).
    await crearUsuario({
      email: f.email.trim(),
      nombre: f.nombre.trim(),
      password: f.password,
      roleId: f.roleId,
      sedeId: f.sedeId,
    })
    modalAlta.value = false
    await cargar()
  } catch (e) {
    errorAlta.value = mensajeDeError(e, 'No se pudo crear el usuario')
  } finally {
    guardandoAlta.value = false
  }
}

// --------------------------------------------------------------------- roles

const formRol = ref({ codigo: '', nombre: '' })
const guardandoRol = ref(false)
const rolEnEdicion = ref<Rol | null>(null)
const marcas = ref<Set<string>>(new Set())
const guardandoPermisos = ref(false)

async function guardarRol(): Promise<void> {
  error.value = ''
  if (!formRol.value.codigo.trim() || !formRol.value.nombre.trim()) {
    error.value = 'El código y el nombre del rol son obligatorios'
    return
  }
  guardandoRol.value = true
  try {
    const creado = await crearRol({
      codigo: formRol.value.codigo.trim(),
      nombre: formRol.value.nombre.trim(),
    })
    formRol.value = { codigo: '', nombre: '' }
    // El alta no trae la relación `permisos`: se recarga la lista (verdad
    // del servidor) en lugar de injertar el objeto incompleto.
    roles.value = await listarRoles()
    const fresco = roles.value.find((r) => r.id === creado.id)
    if (fresco) elegirRol(fresco)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudo crear el rol')
  } finally {
    guardandoRol.value = false
  }
}

function elegirRol(rol: Rol): void {
  rolEnEdicion.value = rol
  marcas.value = new Set(codigosDeRol(rol))
}

function alternarPermiso(codigo: string): void {
  const siguiente = new Set(marcas.value)
  if (siguiente.has(codigo)) siguiente.delete(codigo)
  else siguiente.add(codigo)
  marcas.value = siguiente
}

async function guardarPermisos(): Promise<void> {
  if (!rolEnEdicion.value) return
  error.value = ''
  guardandoPermisos.value = true
  try {
    const actualizado = await asignarPermisos(rolEnEdicion.value.id, [...marcas.value])
    roles.value = roles.value.map((r) => (r.id === actualizado.id ? actualizado : r))
    elegirRol(actualizado)
  } catch (e) {
    error.value = mensajeDeError(e, 'No se pudieron guardar los permisos')
  } finally {
    guardandoPermisos.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-8">
    <ModuloHero etiqueta="Administración" titulo="Usuarios y roles" descripcion="Gestiona el equipo, sus sedes y los permisos efectivos de cada rol." :icono="UserGroupIcon" :metrica="String(usuarios.length)" metrica-etiqueta="En el equipo">
        <button
          v-if="puedeRoles"
          type="button"
          class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          @click="abrirAlta"
        >
          Nuevo usuario
        </button>
    </ModuloHero>
    <section>

      <div class="mt-4">
        <input
          v-model="busqueda"
          type="text"
          placeholder="Buscar por nombre, correo o rol…"
          class="w-full rounded-md border border-line bg-background px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <AvisoError v-if="error" class="mt-4" :mensaje="error" />
      <CargandoBloque v-if="cargando" texto="Cargando equipo…" />

      <EstadoVacio
        v-else-if="filtrados.length === 0"
        class="mt-4"
        titulo="Sin usuarios"
        :detalle="busqueda ? 'Ninguno coincide con la búsqueda.' : 'Registra el primero con «Nuevo usuario».'"
      />

      <div v-else class="mt-4 overflow-x-auto rounded-lg border border-line bg-background">
        <table class="w-full text-sm">
          <thead class="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th class="px-4 py-2 font-medium">Nombre</th>
              <th class="px-4 py-2 font-medium">Correo</th>
              <th class="px-4 py-2 font-medium">Rol</th>
              <th class="px-4 py-2 font-medium">Sede</th>
              <th class="px-4 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in filtrados" :key="u.id" class="border-b border-line last:border-0">
              <td class="px-4 py-2 text-ink">{{ u.nombre }}</td>
              <td class="px-4 py-2 text-muted">{{ u.email }}</td>
              <td class="px-4 py-2 text-muted">{{ u.memberships[0]?.role.nombre ?? '—' }}</td>
              <td class="px-4 py-2 text-muted">{{ u.memberships[0]?.sede?.nombre ?? '—' }}</td>
              <td class="px-4 py-2">
                <span
                  class="rounded px-1.5 py-0.5 text-[11px] font-medium"
                  :class="
                    u.estado === 'ACTIVE'
                      ? 'bg-success/10 text-success'
                      : 'bg-background-soft text-muted'
                  "
                >
                  {{ etiquetaEstadoUsuario(u.estado) }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section v-if="puedeRoles" aria-label="Roles y permisos">
      <header class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold text-ink">Roles</h2>
          <p class="mt-0.5 text-sm text-muted">{{ roles.length }} roles · {{ catalogo.length }} permisos en el catálogo</p>
        </div>
      </header>

      <form class="mt-4 flex flex-wrap items-end gap-2" @submit.prevent="guardarRol">
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="rol-codigo">Código</label>
          <input
            id="rol-codigo"
            v-model="formRol.codigo"
            type="text"
            placeholder="RECEPCION"
            class="w-44 rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="rol-nombre">Nombre</label>
          <input
            id="rol-nombre"
            v-model="formRol.nombre"
            type="text"
            placeholder="Recepción"
            class="w-56 rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
          :disabled="guardandoRol"
        >
          {{ guardandoRol ? 'Creando…' : 'Crear rol' }}
        </button>
      </form>

      <div class="mt-4 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <ul class="space-y-2">
          <li v-for="r in roles" :key="r.id">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm"
              :class="
                rolEnEdicion?.id === r.id
                  ? 'border-primary ring-2 ring-primary'
                  : 'border-line hover:bg-background-soft'
              "
              @click="elegirRol(r)"
            >
              <span>
                <span class="font-medium text-ink">{{ r.nombre }}</span>
                <span class="ml-2 rounded bg-background-soft px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  {{ r.codigo }}
                </span>
              </span>
              <span class="shrink-0 text-xs text-muted">
                {{ codigosDeRol(r).length }} permiso{{ codigosDeRol(r).length === 1 ? '' : 's' }}
              </span>
            </button>
          </li>
        </ul>

        <div class="rounded-lg border border-line bg-background p-4">
          <p v-if="!rolEnEdicion" class="text-sm text-muted">
            Elige un rol para editar sus permisos.
          </p>
          <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h3 class="text-sm font-semibold text-ink">
                {{ rolEnEdicion.nombre }}
                <span class="ml-1 text-xs font-normal text-muted">
                  {{ marcas.size }} de {{ catalogo.length }} permisos
                </span>
              </h3>
              <button
                type="button"
                class="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
                :disabled="guardandoPermisos"
                @click="guardarPermisos"
              >
                {{ guardandoPermisos ? 'Guardando…' : 'Guardar permisos' }}
              </button>
            </div>
            <div class="mt-3 space-y-3">
              <fieldset v-for="g in gruposPermisos" :key="g.recurso">
                <legend class="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                  {{ g.recurso }}
                </legend>
                <div class="grid gap-1 sm:grid-cols-2">
                  <label
                    v-for="p in g.permisos"
                    :key="p.codigo"
                    class="flex cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-sm hover:bg-background-soft"
                  >
                    <input
                      type="checkbox"
                      class="h-4 w-4 shrink-0 accent-primary"
                      :checked="marcas.has(p.codigo)"
                      @change="alternarPermiso(p.codigo)"
                    />
                    <span class="text-ink">{{ p.accion }}</span>
                    <span class="font-mono text-[10px] text-muted">{{ p.codigo }}</span>
                  </label>
                </div>
              </fieldset>
            </div>
          </template>
        </div>
      </div>
    </section>

    <ModalBase v-if="modalAlta" titulo="Nuevo usuario" ancho="sm" @cerrar="modalAlta = false">
      <AvisoError v-if="errorAlta" class="mb-4" :mensaje="errorAlta" />
      <form class="grid gap-3" @submit.prevent="guardarAlta">
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="usr-nombre">Nombre</label>
          <input
            id="usr-nombre"
            v-model="formAlta.nombre"
            type="text"
            autocomplete="off"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="usr-email">Correo</label>
          <input
            id="usr-email"
            v-model="formAlta.email"
            type="email"
            autocomplete="off"
            class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs font-medium text-ink" for="usr-clave">
            Contraseña (mínimo 12 caracteres)
          </label>
          <div class="flex gap-2">
            <input
              id="usr-clave"
              v-model="formAlta.password"
              :type="verClave ? 'text' : 'password'"
              autocomplete="new-password"
              class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="button"
              class="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs text-ink hover:bg-background-soft"
              @click="verClave = !verClave"
            >
              {{ verClave ? 'Ocultar' : 'Ver' }}
            </button>
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="mb-1 block text-xs font-medium text-ink" for="usr-rol">Rol</label>
            <select
              id="usr-rol"
              v-model="formAlta.roleId"
              class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="" disabled>Elegir…</option>
              <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.nombre }}</option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink" for="usr-sede">Sede</label>
            <select
              id="usr-sede"
              v-model="formAlta.sedeId"
              class="w-full rounded-md border border-line bg-background-soft px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="" disabled>Elegir…</option>
              <option v-for="s in sedes" :key="s.id" :value="s.id">{{ s.nombre }}</option>
            </select>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-background-soft disabled:opacity-60"
            :disabled="guardandoAlta"
            @click="modalAlta = false"
          >
            Cancelar
          </button>
          <button
            type="submit"
            class="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-60"
            :disabled="guardandoAlta"
          >
            {{ guardandoAlta ? 'Creando…' : 'Crear usuario' }}
          </button>
        </div>
      </form>
    </ModalBase>
  </div>
</template>
