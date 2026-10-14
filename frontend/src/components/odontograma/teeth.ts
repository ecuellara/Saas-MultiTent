// Catálogo FDI / Sistema Dígito Dos (NTS 188-MINSA).
// Cuadrantes: 1 sup-der, 2 sup-izq, 3 inf-izq, 4 inf-der (permanentes);
// 5 sup-der, 6 sup-izq, 7 inf-izq, 8 inf-der (deciduos).

export type ToothTemplate = 'incisivo' | 'canino' | 'premolar' | 'molar';

export interface ToothMeta {
  fdi: string;
  quadrant: number;
  position: number;
  tipo: ToothTemplate;
  nombre: string;
  /** premolar/molar → superficie oclusal `O`; si no → incisal `I`. */
  posterior: boolean;
  /** El lado mesial queda a la derecha del dibujo. */
  mesialRight: boolean;
  /** Arcada superior: vestibular arriba, palatino/lingual abajo. */
  superior: boolean;
  decidua: boolean;
}

const NOMBRES_PERM = [
  'Incisivo central',
  'Incisivo lateral',
  'Canino',
  'Primer premolar',
  'Segundo premolar',
  'Primer molar',
  'Segundo molar',
  'Tercer molar',
];

const NOMBRES_TEMP = [
  'Incisivo central temporal',
  'Incisivo lateral temporal',
  'Canino temporal',
  'Primer molar temporal',
  'Segundo molar temporal',
];

const LADOS: Record<number, string> = {
  1: 'superior derecho',
  2: 'superior izquierdo',
  3: 'inferior izquierdo',
  4: 'inferior derecho',
  5: 'superior derecho',
  6: 'superior izquierdo',
  7: 'inferior izquierdo',
  8: 'inferior derecho',
};

/** Metadatos clínicos de una pieza FDI (cuadrante, posición, tipo, orientación). */
export function toothMeta(fdi: string): ToothMeta {
  const quadrant = Number(fdi[0]);
  const position = Number(fdi[1]);
  const decidua = quadrant >= 5;
  const tipo: ToothTemplate =
    position <= 2 ? 'incisivo' : position === 3 ? 'canino' : position <= 5 ? 'premolar' : 'molar';
  const base = decidua ? NOMBRES_TEMP[position - 1] : NOMBRES_PERM[position - 1];
  return {
    fdi,
    quadrant,
    position,
    tipo,
    nombre: `${base} ${LADOS[quadrant]}`,
    posterior: position >= 4,
    mesialRight: [1, 4, 5, 8].includes(quadrant),
    superior: [1, 2, 5, 6].includes(quadrant),
    decidua,
  };
}

export const PERMANENTES_SUP = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28'];
export const PERMANENTES_INF = ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38'];
export const DECIDUOS_SUP = ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65'];
export const DECIDUOS_INF = ['85', '84', '83', '82', '81', '71', '72', '73', '74', '75'];
