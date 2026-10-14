import {
  ArchiveBoxIcon,
  BanknotesIcon,
  BeakerIcon,
  BuildingOfficeIcon,
  CalendarDaysIcon,
  ClipboardDocumentCheckIcon,
  Cog6ToothIcon,
  HomeIcon,
  ShoppingCartIcon,
  TagIcon,
  TruckIcon,
  UserGroupIcon,
  UsersIcon,
} from '@heroicons/vue/24/outline'
import type { Component } from 'vue'

export interface ItemNavegacion {
  etiqueta: string
  ruta: string
  icono: Component
  /** Permiso necesario para VER el item. */
  permiso?: string
  /** Feature del plan; sin ella el item no se muestra (p. ej. multi-sede). */
  feature?: string
  seccion: 'Principal' | 'Operación' | 'Administración' | 'Sistema'
}

/**
 * Menú de la clínica.
 *
 * Regla: **el frontend oculta, el backend rechaza.** Ocultar un item mejora la
 * experiencia, pero no es una barrera de seguridad: cada endpoint exige su
 * permiso en el servidor (hoy `patients.read` en toda lectura clínica).
 */
export const NAVEGACION: ItemNavegacion[] = [
  { etiqueta: 'Panel', ruta: '/', icono: HomeIcon, seccion: 'Principal' },
  { etiqueta: 'Pacientes', ruta: '/pacientes', icono: UsersIcon, permiso: 'patients.read', seccion: 'Principal' },
  { etiqueta: 'Agenda', ruta: '/agenda', icono: CalendarDaysIcon, permiso: 'appointments.read', seccion: 'Principal' },
  { etiqueta: 'Tratamientos', ruta: '/tratamientos', icono: TagIcon, permiso: 'patients.read', seccion: 'Principal' },
  { etiqueta: 'Odontograma', ruta: '/odontograma', icono: BeakerIcon, permiso: 'patients.read', seccion: 'Principal' },
  {
    etiqueta: 'Consentimientos',
    ruta: '/consentimientos',
    icono: ClipboardDocumentCheckIcon,
    permiso: 'consents.read',
    seccion: 'Principal',
  },
  { etiqueta: 'Pagos', ruta: '/pagos', icono: BanknotesIcon, permiso: 'payments.read', seccion: 'Principal' },
  { etiqueta: 'Inventario', ruta: '/inventario', icono: ArchiveBoxIcon, permiso: 'inventory.read', seccion: 'Operación' },
  { etiqueta: 'Compras', ruta: '/compras', icono: ShoppingCartIcon, permiso: 'inventory.read', seccion: 'Operación' },
  { etiqueta: 'Proveedores', ruta: '/proveedores', icono: TruckIcon, permiso: 'inventory.read', seccion: 'Operación' },
  { etiqueta: 'Usuarios', ruta: '/usuarios', icono: UserGroupIcon, permiso: 'users.manage', seccion: 'Administración' },
  { etiqueta: 'Sedes', ruta: '/sedes', icono: BuildingOfficeIcon, permiso: 'sedes.manage', seccion: 'Administración' },
  { etiqueta: 'Configuración', ruta: '/configuracion', icono: Cog6ToothIcon, seccion: 'Sistema' },
]
