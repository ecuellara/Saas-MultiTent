/**
 * Enlaces `wa.me` de WhatsApp MANUAL (sin API de Meta).
 *
 * La clínica escribe teléfonos locales y variados (`999 000 111`, `+51 ...`,
 * con guiones o espacios): `wa.me` exige solo dígitos con código de país, así
 * que todo teléfono pasa por `normalizarTelefono` y un resultado `null`
 * deshabilita el botón (un teléfono mal formado es un enlace roto).
 */

/** Dígitos E.164 válidos con país: entre 10 y 15 (el máximo del estándar). */
const MIN_DIGITOS = 10
const MAX_DIGITOS = 15

/**
 * Normaliza al formato internacional (solo dígitos, con código de país).
 *
 * Reglas (Perú por defecto, `codigoPais = '51'`):
 * - se ignoran espacios, guiones, paréntesis y el `+` inicial;
 * - `00...` (prefijo internacional) se recorta;
 * - 9 dígitos que empiezan en 9 → móvil peruano, se antepone el país;
 * - `0` troncal + 10 dígitos → se quita el `0` y vale la regla anterior;
 * - 10–15 dígitos que ya traen país (p. ej. `51...` o `1...`) se dejan tal cual;
 *   un número más corto sin país no se puede enrutar → `null`;
 * - cualquier otra cosa → `null` (mal formado: el botón se deshabilita).
 */
export function normalizarTelefono(
  telefono: string | null | undefined,
  codigoPais = '51',
): string | null {
  if (!telefono) return null
  let digitos = telefono.replace(/\D/g, '')
  if (digitos.startsWith('00')) digitos = digitos.slice(2)
  if (/^0\d{9}$/.test(digitos)) digitos = digitos.slice(1)
  if (/^9\d{8}$/.test(digitos)) digitos = codigoPais + digitos
  if (digitos.length < MIN_DIGITOS || digitos.length > MAX_DIGITOS) return null
  return digitos
}

/** Enlace de chat con el mensaje ya codificado. Solo con teléfono normalizado. */
export function enlaceWhatsapp(telefonoNormalizado: string, mensaje: string): string {
  return `https://wa.me/${telefonoNormalizado}?text=${encodeURIComponent(mensaje)}`
}
