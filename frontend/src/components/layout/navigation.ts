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
}

/**
 * Menú de la clínica.
 *
 * Regla: **el frontend oculta, el backend rechaza.** Ocultar un item mejora la
 * experiencia, pero no es una barrera de seguridad: cada endpoint exige su
 * permiso en el servidor (hoy `patients.read` en toda lectura clínica).
 */
export const NAVEGACION: ItemNavegacion[] = [
  { etiqueta: 'Panel', ruta: '/', icono: HomeIcon },
  { etiqueta: 'Pacientes', ruta: '/pacientes', icono: UsersIcon, permiso: 'patients.read' },
  { etiqueta: 'Agenda', ruta: '/agenda', icono: CalendarDaysIcon, permiso: 'appointments.read' },
  { etiqueta: 'Odontograma', ruta: '/odontograma', icono: BeakerIcon, permiso: 'patients.read' },
  {
    etiqueta: 'Consentimientos',
    ruta: '/consentimientos',
    icono: ClipboardDocumentCheckIcon,
    permiso: 'consents.read',
  },
  { etiqueta: 'Pagos', ruta: '/pagos', icono: BanknotesIcon, permiso: 'payments.read' },
  { etiqueta: 'Inventario', ruta: '/inventario', icono: ArchiveBoxIcon, permiso: 'inventory.read' },
  { etiqueta: 'Compras', ruta: '/compras', icono: ShoppingCartIcon, permiso: 'inventory.read' },
  { etiqueta: 'Proveedores', ruta: '/proveedores', icono: TruckIcon, permiso: 'inventory.read' },
  { etiqueta: 'Usuarios', ruta: '/usuarios', icono: UserGroupIcon, permiso: 'users.manage' },
  { etiqueta: 'Sedes', ruta: '/sedes', icono: BuildingOfficeIcon, permiso: 'sedes.manage' },
  { etiqueta: 'Configuración', ruta: '/configuracion', icono: Cog6ToothIcon },
]
