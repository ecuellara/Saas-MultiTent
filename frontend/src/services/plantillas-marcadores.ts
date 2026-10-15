/**
 * Sustitución de marcadores de las plantillas (puro, sin red).
 *
 * Espejo de la función del backend (`core/catalogo/plantillas.ts`):
 * sustitución simple de `{{marcador}}`, sin motor de plantillas. Vive aparte
 * de `plantillas.ts` (que llama a la API) para poder probarse sin navegador
 * ni red.
 */

/** Marcadores permitidos (los mismos del backend). */
export const MARCADORES_PERMITIDOS = ['paciente', 'fecha', 'hora', 'clinica', 'odontologo', 'sede']

/** Espejo del backend: solo sustituye `{{marcador}}` permitidos. */
export function sustituirMarcadores(texto: string, valores: Record<string, string>): string {
  return texto.replace(/{{\s*([a-z]+)\s*}}/g, (todo, clave: string) => {
    if (!MARCADORES_PERMITIDOS.includes(clave)) return todo
    return valores[clave] === undefined ? todo : valores[clave]
  })
}

/** Valores de ejemplo para la vista previa (no se envían a ningún lado). */
export const EJEMPLO_MARCADORES: Record<string, string> = {
  paciente: 'Valeria Quispe',
  fecha: '20/10/2026',
  hora: '10:00',
  clinica: 'Clínica Demo',
  odontologo: 'Dra. Ejemplo',
  sede: 'Sede principal',
}

export function vistaPrevia(texto: string): string {
  return sustituirMarcadores(texto, EJEMPLO_MARCADORES)
}
