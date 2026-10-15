/**
 * Calendario suscribible (ICS) y enlace «Añadir a Google Calendar».
 *
 * ÚNICA conversión fecha/hora del backend: el feed (`servirFeed`) y cualquier
 * otro consumidor deben usar `citaLimaAUtc`. No duplicarla en otro archivo.
 *
 * La cita se guarda como fecha civil (`@db.Date`, medianoche UTC) + horas
 * `HH:MM` interpretadas en hora de la clínica.
 */

/**
 * Desplazamiento fijo de la clínica: America/Lima = UTC-5 SIN horario de
 * verano. Un offset constante es correcto aquí; si la clínica cambiara de zona
 * habría que sustituirlo por una conversión con zona horaria real.
 */
export const DESPLAZAMIENTO_LIMA_MINUTOS = -5 * 60;

/** Ventana del feed: citas desde hace 30 días hasta dentro de 180. */
export const VENTANA_FEED_DIAS = { pasado: 30, futuro: 180 } as const;

/** Dominio del UID estable (ver `uidCitaEstable`). */
export const DOMINIO_UID_CITA = 'dental-saas';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Instante UTC de una cita a partir de su fecha civil y su hora en Lima.
 *
 * `fecha` es la columna `@db.Date` (medianoche UTC): se leen sus partes en UTC
 * para no desplazar el día (ver `partesFecha` en `CitasService`). La hora se
 * interpreta como hora de pared en Lima y se convierte sumando 5 h.
 */
export function citaLimaAUtc(fecha: Date | string, hora: string): Date {
  if (!HORA.test(hora)) throw new Error(`Hora inválida para el calendario: ${hora}`);
  const d = new Date(fecha);
  if (Number.isNaN(d.getTime())) throw new Error('Fecha inválida para el calendario');
  const [hh, mm] = hora.split(':').map(Number) as [number, number];
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm) -
      DESPLAZAMIENTO_LIMA_MINUTOS * 60_000,
  );
}

/** `Date` → `YYYYMMDDTHHMMSSZ` (formato UTC que exige el ICS y Google). */
export function aUtcIcs(instante: Date): string {
  const p = (n: number, l = 2): string => String(n).padStart(l, '0');
  return (
    `${instante.getUTCFullYear()}${p(instante.getUTCMonth() + 1)}${p(instante.getUTCDate())}` +
    `T${p(instante.getUTCHours())}${p(instante.getUTCMinutes())}${p(instante.getUTCSeconds())}Z`
  );
}

/**
 * UID ESTABLE de la cita: `cita-<id>@dental-saas`.
 *
 * Es lo más importante del feed: con el mismo UID, una reprogramación
 * ACTUALIZA el evento en el calendario en lugar de duplicarlo.
 */
export function uidCitaEstable(citaId: string): string {
  return `cita-${citaId}@${DOMINIO_UID_CITA}`;
}

/** Escapa `\,`, `\;`, `\\` y saltos de línea según RFC 5545. */
export function escaparTextoIcs(texto: string): string {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

const MAX_OCTETOS_LINEA = 75;

/** Longitud UTF-8 en octetos (el plegado del ICS cuenta octetos, no caracteres). */
function octetos(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Pliega UNA línea lógica a 75 octetos con CRLF + espacio (RFC 5545 §3.1).
 * No parte un carácter multibyte: el corte se hace por carácter completo.
 */
export function plegarLineaIcs(linea: string): string {
  let salida = '';
  let actual = '';
  let usados = 0;
  // `true` en la primera línea física (75 octetos); las de continuación llevan
  // un espacio inicial que cuenta (74 de contenido).
  let limite = MAX_OCTETOS_LINEA;
  for (const ch of linea) {
    const len = octetos(ch);
    if (usados + len > limite) {
      salida += `${actual}\r\n `;
      actual = '';
      usados = 1; // el espacio de continuación
      limite = MAX_OCTETOS_LINEA;
    }
    actual += ch;
    usados += len;
  }
  return salida + actual;
}

/** Cita ya resuelta (nombres, no ids) para construir el ICS. Solo lo que necesita un calendario. */
export interface CitaParaIcs {
  id: string;
  /** Columna `@db.Date` (medianoche UTC). */
  fecha: Date | string;
  horaInicio: string;
  horaFin: string;
  estado: string;
  pacienteNombre: string;
  tratamientoNombre: string | null;
  sedeNombre: string | null;
  /** Token legible de la cita (p. ej. `CIT-0001`), o null. */
  tokenCita: string | null;
}

/** `STATUS` coherente con el estado. Las canceladas nunca llegan aquí (se excluyen). */
export function estadoAIcsStatus(estado: string): 'TENTATIVE' | 'CONFIRMED' | 'CANCELLED' {
  if (estado === 'pendiente') return 'TENTATIVE';
  if (estado === 'no_asistio') return 'CANCELLED';
  return 'CONFIRMED';
}

/**
 * `SEQUENCE` coherente con el estado: 0 salvo reprogramación (1). El UID
 * estable es lo que permite actualizar; la secuencia ayuda al cliente a
 * ordenar cambios que lleguen desordenados.
 */
export function estadoAIcsSequence(estado: string): number {
  return estado === 'reprogramada' ? 1 : 0;
}

/**
 * Construye el documento ICS completo (VCALENDAR + un VEVENT por cita).
 * Todo el documento usa CRLF y líneas plegadas a 75 octetos.
 */
export function construirIcs(
  nombreCalendario: string,
  citas: CitaParaIcs[],
  ahora: Date = new Date(),
): string {
  const fisicas: string[] = [];
  const linea = (logica: string): void => {
    fisicas.push(plegarLineaIcs(logica));
  };

  linea('BEGIN:VCALENDAR');
  linea('VERSION:2.0');
  linea('PRODID:-//Dental SaaS//Agenda//ES');
  linea('CALSCALE:GREGORIAN');
  linea('METHOD:PUBLISH');
  linea(`X-WR-CALNAME:${escaparTextoIcs(nombreCalendario)}`);
  const sello = aUtcIcs(ahora);

  for (const c of citas) {
    const inicio = citaLimaAUtc(c.fecha, c.horaInicio);
    const fin = citaLimaAUtc(c.fecha, c.horaFin);
    const titulo = c.tratamientoNombre
      ? `${c.pacienteNombre} — ${c.tratamientoNombre}`
      : c.pacienteNombre;
    linea('BEGIN:VEVENT');
    linea(`UID:${uidCitaEstable(c.id)}`);
    linea(`DTSTAMP:${sello}`);
    linea(`DTSTART:${aUtcIcs(inicio)}`);
    linea(`DTEND:${aUtcIcs(fin)}`);
    linea(`SUMMARY:${escaparTextoIcs(titulo)}`);
    if (c.sedeNombre) linea(`LOCATION:${escaparTextoIcs(c.sedeNombre)}`);
    const detalle = [
      c.tratamientoNombre ? `Tratamiento: ${c.tratamientoNombre}` : null,
      `Estado: ${c.estado}`,
      c.tokenCita ? `Cita ${c.tokenCita}` : null,
    ].filter((x): x is string => x !== null);
    linea(`DESCRIPTION:${escaparTextoIcs(detalle.join(' · '))}`);
    linea(`STATUS:${estadoAIcsStatus(c.estado)}`);
    linea(`SEQUENCE:${estadoAIcsSequence(c.estado)}`);
    linea('TRANSP:OPAQUE');
    linea('END:VEVENT');
  }

  linea('END:VCALENDAR');
  return `${fisicas.join('\r\n')}\r\n`;
}

/**
 * Ventana del feed sobre fechas civiles `YYYY-MM-DD`: [hoy-30, hoy+180].
 * Se calcula en UTC sobre el día actual (el feed es diario, no intradiario).
 */
export function ventanaFeedCivil(hoy: Date = new Date()): { desde: string; hasta: string } {
  const iso = (d: Date): string =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
      d.getUTCDate(),
    ).padStart(2, '0')}`;
  const desde = new Date(
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - VENTANA_FEED_DIAS.pasado),
  );
  const hasta = new Date(
    Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() + VENTANA_FEED_DIAS.futuro),
  );
  return { desde: iso(desde), hasta: iso(hasta) };
}
