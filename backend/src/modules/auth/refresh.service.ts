import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import type { PrismaService } from '../../core/prisma/prisma.service.js';

export const REFRESH_COOKIE = 'refresh_token';
const REFRESH_DIAS = 30;

export interface CookieSpec {
  name: string;
  value: string;
  maxAge: number;
  path: string;
}

export interface TokenPair {
  access_token: string;
  refreshCookie: CookieSpec;
}

type RefreshRow = {
  id: string;
  kind: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

type Db = {
  refreshToken: {
    findUnique: (a: unknown) => Promise<RefreshRow | null>;
    create: (a: unknown) => Promise<RefreshRow>;
    update: (a: unknown) => Promise<unknown>;
    updateMany: (a: unknown) => Promise<unknown>;
  };
};

function dbDe(prisma: PrismaService): Db {
  return prisma as unknown as Db;
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function nuevaCookie(valor: string, kind: 'clinic' | 'platform'): CookieSpec {
  return {
    name: REFRESH_COOKIE,
    value: valor,
    maxAge: REFRESH_DIAS * 24 * 3600,
    path: kind === 'platform' ? '/api/platform/auth' : '/api/auth',
  };
}

/** Crea un refresh opaco (se guarda solo su sha256) y devuelve la cookie. */
export async function crearRefreshToken(
  prisma: PrismaService,
  kind: 'clinic' | 'platform',
  userId: string,
  ip?: string,
): Promise<CookieSpec> {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_DIAS);
  await dbDe(prisma).refreshToken.create({
    data: { kind, userId, tokenHash: hash(token), expiresAt, ip: ip ?? null },
  });
  return nuevaCookie(token, kind);
}

/** Access temporal MFA-pendiente (5 min; no sirve para el panel). */
export function emitirTemporalMfa(
  jwt: JwtService,
  payload: Record<string, unknown>,
): Promise<string> {
  return jwt.signAsync({ ...payload, mfa: 'pending' }, { expiresIn: '5m' });
}

export function leerRefreshCookie(req: { cookies?: Record<string, string> }): string | null {
  const v = req.cookies?.[REFRESH_COOKIE];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export async function revocarRefresh(prisma: PrismaService, presentado: string): Promise<void> {
  await dbDe(prisma).refreshToken.updateMany({
    where: { tokenHash: hash(presentado), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Rotación con detección de reuso: si el refresh presentado ya estaba
 * revocado, se revocan TODOS los del usuario (posible robo) y se rechaza.
 * Devuelve null si inválido/expirado.
 */
export async function rotarRefresh(
  prisma: PrismaService,
  jwt: JwtService,
  kind: 'clinic' | 'platform',
  presentado: string,
  accessPayload: (userId: string) => Record<string, unknown>,
  ip?: string,
): Promise<TokenPair | null> {
  const db = dbDe(prisma);
  const fila = await db.refreshToken.findUnique({ where: { tokenHash: hash(presentado) } });
  if (!fila || fila.kind !== kind || fila.expiresAt.getTime() < Date.now()) return null;
  if (fila.revokedAt) {
    // Reuso detectado: revoca la cadena completa del usuario.
    await db.refreshToken.updateMany({
      where: { kind, userId: fila.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return null;
  }
  const access_token = await jwt.signAsync({ ...accessPayload(fila.userId), mfa: 'ok' });
  const siguiente = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_DIAS);
  const creado = await db.refreshToken.create({
    data: { kind, userId: fila.userId, tokenHash: hash(siguiente), expiresAt, ip: ip ?? null },
  });
  await db.refreshToken.update({
    where: { id: fila.id },
    data: { revokedAt: new Date(), replacedById: creado.id },
  });
  return { access_token, refreshCookie: nuevaCookie(siguiente, kind) };
}
