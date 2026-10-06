import { generate, generateSecret, generateURI, verify } from 'otplib';

/** Envoltorio TOTP (otplib v13, API funcional). */
export function generarSecretoTotp(): string {
  return generateSecret();
}

export function urlOtpauth(email: string, secret: string): string {
  return generateURI({ issuer: 'DentalSaaS', label: email, secret });
}

export async function verificarTotp(secret: string, code: string): Promise<boolean> {
  // Defensa en profundidad: si un llamador pasa algo que no es una cadena (por
  // ejemplo un número desde un cuerpo JSON sin validar), `code.replace` lanzaría
  // y el endpoint respondería 500 en vez de rechazar el intento.
  if (typeof code !== 'string' || code.length === 0) return false;
  const r = await verify({ secret, token: code.replace(/\s/g, '') });
  return r.valid === true;
}

/** Solo para pruebas: genera el código vigente. */
export function generarCodigoTotp(secret: string): Promise<string> {
  return generate({ secret });
}
