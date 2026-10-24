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
 * Catálogo único de plantillas de notificación (WhatsApp manual).
 * Misma razón que los permisos: la fuente vive en `src/core/catalogo` y los
 * scripts la importan desde aquí, sin copias.
 */
export { CATALOGO_PLANTILLAS } from '../src/core/catalogo/plantillas.js';
import { CATALOGO_PLANTILLAS } from '../src/core/catalogo/plantillas.js';

/**
 * Siembra las plantillas por defecto de una clínica (idempotente, upsert por
 * `[tenantId, clave]`). No pisa personalizaciones: solo crea las que faltan y
 * deja el texto editado tal cual.
 */
export async function sembrarPlantillas(prisma: PrismaClient, tenantId: string): Promise<number> {
  // Solo se cuentan las que realmente se crean; el `upsert` también actualiza
  // (sin tocar nada) las que ya existían.
  const previas = await prisma.plantillaWhatsApp.findMany({
    where: { tenantId },
    select: { clave: true },
  });
  const existentes = new Set(previas.map((p) => p.clave));
  let creadas = 0;
  for (const c of CATALOGO_PLANTILLAS) {
    await prisma.plantillaWhatsApp.upsert({
      where: { tenantId_clave: { tenantId, clave: c.clave } },
      update: {},
      create: { tenantId, clave: c.clave, texto: c.texto, activo: true },
    });
    if (!existentes.has(c.clave)) creadas++;
  }
  return creadas;
}
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
    descripcion: 'Una sede, 1 odontologo y hasta 2 usuarios.',
    precioMensual: 79,
    features: [
      { clave: 'multi_sede', habilitado: false, limite: null },
      { clave: 'max_sedes', habilitado: true, limite: 1 },
      { clave: 'max_usuarios', habilitado: true, limite: 2 },
      { clave: 'max_odontologos', habilitado: true, limite: 1 },
    ],
  },
  {
    codigo: 'profesional',
    nombre: 'Profesional',
    descripcion: 'Una sede, hasta 3 odontologos y 5 usuarios.',
    precioMensual: 149,
    features: [
      { clave: 'multi_sede', habilitado: false, limite: null },
      { clave: 'max_sedes', habilitado: true, limite: 1 },
      { clave: 'max_usuarios', habilitado: true, limite: 5 },
      { clave: 'max_odontologos', habilitado: true, limite: 3 },
    ],
  },
  {
    codigo: 'clinica',
    nombre: 'Clinica',
    descripcion: 'Hasta 3 sedes, 8 odontologos y 15 usuarios.',
    precioMensual: 249,
    features: [
      { clave: 'multi_sede', habilitado: true, limite: null },
      { clave: 'max_sedes', habilitado: true, limite: 3 },
      { clave: 'max_usuarios', habilitado: true, limite: 15 },
      { clave: 'max_odontologos', habilitado: true, limite: 8 },
    ],
  },
];

export {
  PLANTILLAS_CONSENTIMIENTO,
  sembrarPlantillasConsentimiento,
  type PlantillaConsentimientoSeed,
} from '../src/core/catalogo/consentimientos.js';
