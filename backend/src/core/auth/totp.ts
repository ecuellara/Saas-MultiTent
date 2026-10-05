import { generate, generateSecret, generateURI, verify } from 'otplib';

/** Envoltorio TOTP (otplib v13, API funcional). */
export function generarSecretoTotp(): string {
  return generateSecret();
}

export function urlOtpauth(email: string, secret: string): string {
  return generateURI({ issuer: 'DentalSaaS', label: email, secret });
}

export async function verificarTotp(secret: string, code: string): Promise<boolean> {
  const r = await verify({ secret, token: code.replace(/\s/g, '') });
  return r.valid === true;
}

/** Solo para pruebas: genera el código vigente. */
export function generarCodigoTotp(secret: string): Promise<string> {
  return generate({ secret });
}
