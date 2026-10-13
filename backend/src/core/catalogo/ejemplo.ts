/**
 * Catálogo de EJEMPLO para estrenar una clínica (precios en soles).
 *
 * Fuente única del botón «cargar catálogo de ejemplo» del panel
 * (`POST /platform/tenants/:id/catalogo-ejemplo`): no incrustar esta lista en
 * el panel ni en el frontend. Si la lista crece, el botón la sigue sin tocar
 * nada más.
 *
 * REGLAS:
 * - NUNCA se siembra solo: solo a petición explícita del panel, tratamiento
 *   por tratamiento, saltando los que ya existen por nombre en ese tenant
 *   (idempotente: se puede pulsar dos veces sin duplicar).
 * - Son PRECIOS DE EJEMPLO: cada clínica debe revisarlos. Una lista de precios
 *   precargada que no encaje es peor que no tenerla, por eso el alta nace con
 *   cero tratamientos y esto es opt-in.
 */
export interface TratamientoEjemplo {
  nombre: string;
  precio: number;
  duracionMin: number;
}

export const CATALOGO_EJEMPLO_TRATAMIENTOS: TratamientoEjemplo[] = [
  { nombre: 'Consulta dental', precio: 60, duracionMin: 20 },
  { nombre: 'Limpieza dental', precio: 120, duracionMin: 30 },
  { nombre: 'Resina simple', precio: 180, duracionMin: 45 },
  { nombre: 'Exodoncia simple', precio: 150, duracionMin: 30 },
  { nombre: 'Endodoncia unirradicular', precio: 450, duracionMin: 60 },
  { nombre: 'Radiografía periapical', precio: 40, duracionMin: 15 },
  { nombre: 'Blanqueamiento dental', precio: 400, duracionMin: 60 },
];
