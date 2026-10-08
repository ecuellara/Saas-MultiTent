/**
 * Catálogo único de permisos del SaaS.
 *
 * Vive en `src` (no en `prisma/`) porque el código de aplicación lo necesita
 * en tiempo de ejecución (alta de clínicas, roles) y el build (`rootDir:
 * "src"`) no admite importaciones fuera de `src`. Los seeds lo importan
 * desde aquí: una sola fuente.
 */
export interface PermisoCatalogo {
  codigo: string;
  recurso: string;
  accion: string;
}

export const CATALOGO_PERMISOS: PermisoCatalogo[] = [
  { codigo: 'patients.read', recurso: 'patients', accion: 'read' },
  { codigo: 'patients.write', recurso: 'patients', accion: 'write' },
  { codigo: 'patients.delete', recurso: 'patients', accion: 'delete' },
  { codigo: 'appointments.read', recurso: 'appointments', accion: 'read' },
  { codigo: 'appointments.write', recurso: 'appointments', accion: 'write' },
  // Leer cobros es distinto de registrarlos: los importes y el arqueo son
  // información sensible, así que tiene permiso propio.
  { codigo: 'payments.read', recurso: 'payments', accion: 'read' },
  { codigo: 'payments.write', recurso: 'payments', accion: 'write' },
  { codigo: 'payments.cancel', recurso: 'payments', accion: 'cancel' },
  // Leer stock y compras es distinto de moverlos: los precios de proveedor y
  // el valorizado son información sensible, así que tiene permiso propio.
  { codigo: 'inventory.read', recurso: 'inventory', accion: 'read' },
  { codigo: 'inventory.write', recurso: 'inventory', accion: 'write' },
  { codigo: 'consents.read', recurso: 'consents', accion: 'read' },
  { codigo: 'consents.write', recurso: 'consents', accion: 'write' },
  { codigo: 'users.manage', recurso: 'users', accion: 'manage' },
  { codigo: 'roles.manage', recurso: 'roles', accion: 'manage' },
  { codigo: 'members.manage', recurso: 'members', accion: 'manage' },
  { codigo: 'sedes.manage', recurso: 'sedes', accion: 'manage' },
];
