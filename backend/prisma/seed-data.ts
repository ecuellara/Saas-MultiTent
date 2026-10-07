/**
 * Catálogo único de permisos del SaaS.
 * El fixture de pruebas (`PERMISOS_BASE`) debe ser un subconjunto de este.
 *
 * La lista vive en `src/core/catalogo/permisos.ts` (el build con
 * `rootDir: "src"` no admite importaciones fuera de `src`); aquí se
 * re-exporta para los scripts.
 */
export { CATALOGO_PERMISOS } from '../src/core/catalogo/permisos.js';

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
