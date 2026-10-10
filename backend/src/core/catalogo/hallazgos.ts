/**
 * Catálogo único de hallazgos del odontograma (NTS 188).
 *
 * Vive en `src` (no en `prisma/`) por la misma razón que `CATALOGO_PERMISOS`:
 * el código de aplicación lo necesita en tiempo de ejecución y el build
 * (`rootDir: "src"`) no admite importaciones fuera de `src`. Los seeds
 * (`prisma/seed.ts`, `prisma/seed-demo.ts`) y el fixture de pruebas
 * (`test/helpers/tenants-fixture.ts`) lo importan desde aquí: una sola
 * fuente, sin copias que puedan divergir.
 *
 * Convención de color NTS 188: el ROJO marca patología o tratamiento
 * pendiente y el AZUL lo ya realizado. El servidor deriva `estadoClinico` y
 * `color` de esta tabla al registrar un hallazgo; el cliente nunca los fija
 * (el DTO ni siquiera declara esos campos y el whitelist los rechaza).
 */
export interface HallazgoCatalogoSeed {
  codigo: string;
  nombre: string;
  abreviatura: string;
  /** 'superficie' admite `superficies`; 'pieza' las prohíbe. */
  alcance: 'superficie' | 'pieza';
  requiereSuperficie: boolean;
  requiereMaterial: boolean;
  colorDefecto: string;
}

export const CATALOGO_HALLAZGOS: HallazgoCatalogoSeed[] = [
  // CARIES y OBTURADO conservan EXACTAMENTE los valores que usan las
  // pruebas: no cambiar códigos ni propiedades sin actualizar los specs.
  { codigo: 'CARIES', nombre: 'Lesión de caries dental', abreviatura: 'C', alcance: 'superficie', requiereSuperficie: true, requiereMaterial: false, colorDefecto: 'rojo' },
  { codigo: 'OBTURADO', nombre: 'Restauración', abreviatura: 'O', alcance: 'superficie', requiereSuperficie: true, requiereMaterial: true, colorDefecto: 'azul' },
  // Hallazgos de superficie: la lesión se localiza en una o más caras.
  { codigo: 'FRACTURA', nombre: 'Fractura dental', abreviatura: 'F', alcance: 'superficie', requiereSuperficie: true, requiereMaterial: false, colorDefecto: 'rojo' },
  { codigo: 'SELLANTE', nombre: 'Sellante de fosas y fisuras', abreviatura: 'S', alcance: 'superficie', requiereSuperficie: true, requiereMaterial: false, colorDefecto: 'azul' },
  // Hallazgos de pieza completa: no admiten superficies.
  { codigo: 'ENDODONCIA', nombre: 'Tratamiento de endodoncia', abreviatura: 'E', alcance: 'pieza', requiereSuperficie: false, requiereMaterial: false, colorDefecto: 'azul' },
  { codigo: 'CORONA', nombre: 'Corona protésica', abreviatura: 'R', alcance: 'pieza', requiereSuperficie: false, requiereMaterial: true, colorDefecto: 'azul' },
  { codigo: 'EXTRACCION_INDICADA', nombre: 'Extracción indicada', abreviatura: 'EI', alcance: 'pieza', requiereSuperficie: false, requiereMaterial: false, colorDefecto: 'rojo' },
  { codigo: 'AUSENTE', nombre: 'Diente ausente', abreviatura: 'X', alcance: 'pieza', requiereSuperficie: false, requiereMaterial: false, colorDefecto: 'azul' },
  { codigo: 'IMPLANTE', nombre: 'Implante dental', abreviatura: 'I', alcance: 'pieza', requiereSuperficie: false, requiereMaterial: false, colorDefecto: 'azul' },
];
