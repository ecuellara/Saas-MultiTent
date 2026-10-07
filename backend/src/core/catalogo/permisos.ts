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
  { codigo: 'payments.write', recurso: 'payments', accion: 'write' },
  { codigo: 'payments.cancel', recurso: 'payments', accion: 'cancel' },
  { codigo: 'inventory.write', recurso: 'inventory', accion: 'write' },
  { codigo: 'consents.read', recurso: 'consents', accion: 'read' },
  { codigo: 'consents.write', recurso: 'consents', accion: 'write' },
  { codigo: 'users.manage', recurso: 'users', accion: 'manage' },
  { codigo: 'roles.manage', recurso: 'roles', accion: 'manage' },
  { codigo: 'members.manage', recurso: 'members', accion: 'manage' },
  { codigo: 'sedes.manage', recurso: 'sedes', accion: 'manage' },
];
