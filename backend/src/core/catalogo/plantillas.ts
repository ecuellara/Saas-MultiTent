/**
 * Catálogo único de plantillas de notificación (WhatsApp manual).
 *
 * Vive en `src` (no en `prisma/`) por el mismo motivo que el catálogo de
 * permisos: el código lo necesita en tiempo de ejecución (alta de clínicas,
 * seeds, validación de claves) y los seeds lo importan desde aquí.
 *
 * Las plantillas son para envío MANUAL (`wa.me`, sin API de Meta): el texto se
 * edita por clínica (`PlantillaWhatsApp`, único por `[tenantId, clave]`) y el
 * mensaje se compone en el cliente sustituyendo marcadores.
 */

/** Marcadores permitidos en los textos (sustitución simple, sin motor). */
export const MARCADORES_PLANTILLA = [
  'paciente',
  'fecha',
  'hora',
  'clinica',
  'odontologo',
  'sede',
] as const;

export type MarcadorPlantilla = (typeof MARCADORES_PLANTILLA)[number];

/** Qué valor lleva cada marcador (lo documenta la pantalla de plantillas). */
export const DESCRIPCION_MARCADORES: Record<MarcadorPlantilla, string> = {
  paciente: 'Nombres y apellidos del paciente',
  fecha: 'Fecha de la cita (dd/mm/aaaa)',
  hora: 'Hora de inicio de la cita (HH:MM)',
  clinica: 'Nombre de la clínica',
  odontologo: 'Nombre del odontólogo asignado',
  sede: 'Nombre de la sede de la cita',
};

export interface PlantillaCatalogo {
  clave: string;
  nombre: string;
  /** Texto por defecto, con `{{marcadores}}`. */
  texto: string;
  marcadores: MarcadorPlantilla[];
}

export const CATALOGO_PLANTILLAS: PlantillaCatalogo[] = [
  {
    clave: 'cita_confirmacion',
    nombre: 'Confirmación de cita',
    texto:
      'Hola {{paciente}}, tu cita en {{clinica}} es el {{fecha}} a las {{hora}} con {{odontologo}} ({{sede}}). Responde este mensaje para confirmar.',
    marcadores: ['paciente', 'fecha', 'hora', 'clinica', 'odontologo', 'sede'],
  },
  {
    clave: 'cita_cancelacion',
    nombre: 'Cancelación de cita',
    texto:
      'Hola {{paciente}}, tu cita del {{fecha}} a las {{hora}} en {{clinica}} fue cancelada. Escríbenos para reprogramarla.',
    marcadores: ['paciente', 'fecha', 'hora', 'clinica'],
  },
  {
    clave: 'cita_reprogramacion',
    nombre: 'Reprogramación de cita',
    texto:
      'Hola {{paciente}}, tu cita en {{clinica}} se reprogramó para el {{fecha}} a las {{hora}} con {{odontologo}} ({{sede}}).',
    marcadores: ['paciente', 'fecha', 'hora', 'clinica', 'odontologo', 'sede'],
  },
];

/**
 * Sustitución simple de `{{marcador}}` (con o sin espacios).
 * Solo sustituye marcadores permitidos; el resto se deja tal cual para no
 * romper el texto si alguien escribe llaves literales.
 */
export function sustituirMarcadores(
  texto: string,
  valores: Partial<Record<MarcadorPlantilla, string>>,
): string {
  return texto.replace(/{{\s*([a-z]+)\s*}}/g, (todo, clave: string) => {
    if (!(MARCADORES_PLANTILLA as readonly string[]).includes(clave)) return todo;
    const valor = valores[clave as MarcadorPlantilla];
    return valor === undefined ? todo : valor;
  });
}
