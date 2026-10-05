/**
 * Catálogo único de permisos del SaaS.
 * El fixture de pruebas (`PERMISOS_BASE`) debe ser un subconjunto de este.
 */
export const CATALOGO_PERMISOS: Array<{ codigo: string; recurso: string; accion: string }> = [
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
  { codigo: 'sedes.manage', recurso: 'sedes', accion: 'manage' },
  { codigo: 'roles.manage', recurso: 'roles', accion: 'manage' },
  { codigo: 'members.manage', recurso: 'members', accion: 'manage' },
  { codigo: 'users.manage', recurso: 'users', accion: 'manage' },
];

export interface PlanSeed {
  codigo: string;
  nombre: string;
  descripcion: string;
  precioMensual: number;
  features: Array<{ clave: string; habilitado: boolean; limite: number | null }>;
}

/**
 * Planes base (etapa 1, facturación manual — ADR-008).
 * `multi_sede` es feature booleana; `max_sedes`/`max_usuarios` son límites.
 */
export const PLANES_BASE: PlanSeed[] = [
  {
    codigo: 'consultorio',
    nombre: 'Consultorio',
    descripcion: 'Una sede, hasta 5 usuarios.',
    precioMensual: 99,
    features: [
      { clave: 'multi_sede', habilitado: false, limite: null },
      { clave: 'max_sedes', habilitado: true, limite: 1 },
      { clave: 'max_usuarios', habilitado: true, limite: 5 },
    ],
  },
  {
    codigo: 'clinica',
    nombre: 'Clínica',
    descripcion: 'Multi-sede, hasta 20 usuarios.',
    precioMensual: 249,
    features: [
      { clave: 'multi_sede', habilitado: true, limite: null },
      { clave: 'max_sedes', habilitado: true, limite: 3 },
      { clave: 'max_usuarios', habilitado: true, limite: 20 },
    ],
  },
];
