import { createRouter, createWebHistory } from 'vue-router'
import { useSessionStore } from '../stores/session'

declare module 'vue-router' {
  interface RouteMeta {
    /** Accesible sin sesión. */
    publico?: boolean
    /** Permiso exigido para entrar (el backend lo exige igualmente). */
    permiso?: string
  }
}

/** Vista de relleno para los módulos que aún no están construidos. */
const EnConstruccion = () => import('../views/EnConstruccionView.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/auth/LoginView.vue'),
      meta: { publico: true },
    },
    {
      path: '/elegir-clinica',
      name: 'elegir-clinica',
      component: () => import('../views/auth/SeleccionClinicaView.vue'),
    },
    {
      path: '/',
      component: () => import('../layouts/AppLayout.vue'),
      children: [
        { path: '', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
        {
          path: 'pacientes',
          name: 'pacientes',
          component: () => import('../views/pacientes/PacientesView.vue'),
          meta: { permiso: 'patients.read' },
        },
        {
          path: 'pacientes/:id',
          name: 'paciente-detalle',
          component: () => import('../views/pacientes/PacienteDetalleView.vue'),
          meta: { permiso: 'patients.read' },
        },
        {
          path: 'agenda',
          name: 'agenda',
          component: EnConstruccion,
          props: { titulo: 'Agenda', descripcion: 'Calendario de citas y recordatorios.' },
          meta: { permiso: 'appointments.read' },
        },
        {
          path: 'odontograma',
          name: 'odontograma',
          component: EnConstruccion,
          props: { titulo: 'Odontograma', descripcion: 'NTS 188 versionado por paciente.' },
          meta: { permiso: 'patients.read' },
        },
        {
          path: 'consentimientos',
          name: 'consentimientos',
          component: EnConstruccion,
          props: { titulo: 'Consentimientos', descripcion: 'Plantillas, firma y PDF.' },
          meta: { permiso: 'consents.read' },
        },
        {
          path: 'pagos',
          name: 'pagos',
          component: EnConstruccion,
          props: { titulo: 'Pagos', descripcion: 'Ingresos, egresos, abonos y cuotas.' },
          meta: { permiso: 'payments.write' },
        },
        {
          path: 'inventario',
          name: 'inventario',
          component: EnConstruccion,
          props: { titulo: 'Inventario', descripcion: 'Insumos, stock y movimientos.' },
          meta: { permiso: 'inventory.write' },
        },
        {
          path: 'compras',
          name: 'compras',
          component: EnConstruccion,
          props: { titulo: 'Compras', descripcion: 'Proveedores y compras.' },
          meta: { permiso: 'inventory.write' },
        },
        {
          path: 'usuarios',
          name: 'usuarios',
          component: EnConstruccion,
          props: { titulo: 'Usuarios', descripcion: 'Cuentas, roles y permisos.' },
          meta: { permiso: 'users.manage' },
        },
        {
          path: 'sedes',
          name: 'sedes',
          component: EnConstruccion,
          props: { titulo: 'Sedes', descripcion: 'Sedes de la clínica.' },
          meta: { permiso: 'sedes.manage' },
        },
        {
          path: 'configuracion',
          name: 'configuracion',
          component: EnConstruccion,
          props: { titulo: 'Configuración', descripcion: 'Datos de la clínica y horarios.' },
        },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

/**
 * Guard de navegación.
 *
 * Reglas:
 *  1. Ruta pública + sesión iniciada → al panel.
 *  2. Sin token → login (recordando el destino).
 *  3. Token pero sesión sin resolver (recarga de página) → se resuelve antes de
 *     decidir, para no parpadear ni mostrar un menú incompleto.
 *  4. Sin clínica elegida → se auto-elige si solo hay una; si hay varias, al
 *     selector.
 *  5. Falta el permiso → al panel (el backend lo rechazaría igualmente).
 */
router.beforeEach(async (to) => {
  const sesion = useSessionStore()

  if (to.meta.publico) {
    return sesion.autenticado ? { name: 'dashboard' } : true
  }

  if (!sesion.autenticado) {
    return { name: 'login', query: { destino: to.fullPath } }
  }

  if (!sesion.usuario) {
    try {
      await sesion.cargarSesion()
    } catch {
      // Token inválido o revocado: se limpia y al login.
      sesion.limpiar()
      return { name: 'login' }
    }
  }

  if (!sesion.tenantId) {
    if (sesion.clinicas.length === 1) {
      await sesion.elegirClinica(sesion.clinicas[0]!.id)
    } else if (to.name !== 'elegir-clinica') {
      return { name: 'elegir-clinica' }
    }
  } else if (to.name === 'elegir-clinica') {
    return { name: 'dashboard' }
  }

  if (to.meta.permiso && !sesion.puede(to.meta.permiso)) {
    return { name: 'dashboard' }
  }

  return true
})

export default router
