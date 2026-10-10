/**
 * Catálogo único de permisos del SaaS.
 * El fixture de pruebas (`PERMISOS_BASE`) debe ser un subconjunto de este.
 *
 * La lista vive en `src/core/catalogo/permisos.ts` (el build con
 * `rootDir: "src"` no admite importaciones fuera de `src`); aquí se
 * re-exporta para los scripts.
 */
export { CATALOGO_PERMISOS } from '../src/core/catalogo/permisos.js';

/**
 * Catálogo único de hallazgos del odontograma (NTS 188).
 * Misma razón que los permisos: la fuente vive en `src/core/catalogo` y los
 * scripts, el seed de demostración y el fixture de pruebas la importan desde
 * aquí, sin copias.
 */
export { CATALOGO_HALLAZGOS, type HallazgoCatalogoSeed } from '../src/core/catalogo/hallazgos.js';
import { CATALOGO_HALLAZGOS } from '../src/core/catalogo/hallazgos.js';
import type { PrismaClient } from '@prisma/client';

/**
 * Siembra el catálogo NTS 188 de forma idempotente (upsert por `codigo`).
 *
 * La usan `db:seed`, `db:seed-demo` y la prueba de idempotencia: el MISMO
 * código en los tres sitios. El catálogo es GLOBAL (la tabla no tiene
 * `tenantId`). Devuelve cuántas entradas siembra, para el resumen del seed.
 */
export async function sembrarCatalogoHallazgos(prisma: PrismaClient): Promise<number> {
  for (const h of CATALOGO_HALLAZGOS) {
    await prisma.hallazgoCatalogo.upsert({
      where: { codigo: h.codigo },
      update: {
        nombre: h.nombre,
        abreviatura: h.abreviatura,
        alcance: h.alcance,
        requiereSuperficie: h.requiereSuperficie,
        requiereMaterial: h.requiereMaterial,
        colorDefecto: h.colorDefecto,
        activo: true,
      },
      create: { id: `hallazgo-${h.codigo}`, ...h },
    });
  }
  return CATALOGO_HALLAZGOS.length;
}

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
