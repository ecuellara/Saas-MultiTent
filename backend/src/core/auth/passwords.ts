import * as argon2 from 'argon2';
import * as bcrypt from 'bcrypt';

const COMUNES = new Set(['123456', 'password', 'qwerty', 'clinica123', 'dental123']);

/** Política de contraseñas (doc §8): mínimo 12 caracteres, sin comunes. */
export function validarPassword(politica: string): void {
  if (politica.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres');
  if (COMUNES.has(politica.toLowerCase())) throw new Error('Contraseña demasiado común');
}

/** Hash nuevo: siempre Argon2id (doc §8, etapa 2). */
export function hashPassword(plain: string): Promise<string> {
  validarPassword(plain);
  return argon2.hash(plain, { type: argon2.argon2id });
}

/**
 * Verifica según el algoritmo almacenado y, si era bcrypt, devuelve el
 * hash ya migrado a Argon2id para actualización transparente al login.
 */
export async function verificarPassword(
  passwordHash: string,
  algo: string | null | undefined,
  plain: string,
): Promise<{ ok: boolean; upgradedHash: string | null }> {
  if ((algo ?? 'bcrypt') === 'argon2id') {
    try {
      return { ok: await argon2.verify(passwordHash, plain), upgradedHash: null };
    } catch {
      return { ok: false, upgradedHash: null };
    }
  }
  const ok = await bcrypt.compare(plain, passwordHash);
  if (!ok) return { ok, upgradedHash: null };
  return { ok, upgradedHash: await argon2.hash(plain, { type: argon2.argon2id }) };
}
