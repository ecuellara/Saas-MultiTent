import { createRouter, createWebHistory } from 'vue-router'
import { usePlataformaStore } from '../stores/plataforma'
import { useSessionStore } from '../stores/session'

declare module 'vue-router' {
  interface RouteMeta {
    /** Accesible sin sesión. */
    publico?: boolean
    /** Permiso exigido para entrar (el backend lo exige igualmente). */
    permiso?: string
    /** Ruta del panel de plataforma: usa su propio store y guard. */
    admin?: boolean
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
      path: '/admin/login',
      name: 'admin-login',
      component: () => import('../views/admin/AdminLoginView.vue'),
      meta: { publico: true, admin: true },
    },
    {
      path: '/admin',
      component: () => import('../layouts/AdminLayout.vue'),
      meta: { admin: true },
      children: [
        { path: '', redirect: { name: 'admin-clinicas' } },
        {
          path: 'clinicas',
          name: 'admin-clinicas',
          component: () => import('../views/admin/ClinicasView.vue'),
        },
        {
          path: 'clinicas/nueva',
          name: 'admin-clinica-alta',
          component: () => import('../views/admin/ClinicaAltaView.vue'),
        },
        {
          path: 'clinicas/:id',
          name: 'admin-clinica-detalle',
          component: () => import('../views/admin/ClinicaDetalleView.vue'),
        },
      ],
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
          component: () => import('../views/agenda/AgendaView.vue'),
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
          component: () => import('../views/consentimientos/ConsentimientosView.vue'),
          meta: { permiso: 'consents.read' },
        },
        {
          path: 'consentimientos/:id/impresion',
          name: 'consentimiento-impresion',
          component: () => import('../views/consentimientos/ConsentimientoImpresionView.vue'),
          meta: { permiso: 'consents.read' },
        },
        {
          path: 'pagos',
          name: 'pagos',
          component: () => import('../views/pagos/PagosView.vue'),
          meta: { permiso: 'payments.read' },
        },
        {
          path: 'pagos/:id',
          name: 'pago-detalle',
          component: () => import('../views/pagos/PagoDetalleView.vue'),
          meta: { permiso: 'payments.read' },
        },
        {
          path: 'inventario',
          name: 'inventario',
          component: () => import('../views/inventario/InventarioView.vue'),
          meta: { permiso: 'inventory.read' },
        },
        {
          path: 'proveedores',
          name: 'proveedores',
          component: () => import('../views/inventario/ProveedoresView.vue'),
          meta: { permiso: 'inventory.read' },
        },
        {
          path: 'compras',
          name: 'compras',
          component: () => import('../views/compras/ComprasView.vue'),
          meta: { permiso: 'inventory.read' },
        },
        {
          path: 'compras/:id',
          name: 'compra-detalle',
          component: () => import('../views/compras/CompraDetalleView.vue'),
          meta: { permiso: 'inventory.read' },
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
          component: () => import('../views/ConfiguracionView.vue'),
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
  // Rama de plataforma: área separada con sesión propia. No toca la sesión
  // de clínica (ni siquiera la lee): mezclarlas filtraría `X-Tenant-Id` a
  // rutas que van con `PlatformGuard`.
  if (to.path.startsWith('/admin')) {
    const plataforma = usePlataformaStore()
    if (to.name === 'admin-login') {
      return plataforma.autenticado ? { name: 'admin-clinicas' } : true
    }
    if (!plataforma.autenticado) {
      return { name: 'admin-login', query: { destino: to.fullPath } }
    }
    return true
  }

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
