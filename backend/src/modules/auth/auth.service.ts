import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { hashPassword, validarPassword, verificarPassword } from '../../core/auth/passwords.js';
import {
  REFRESH_COOKIE,
  TokenPair,
  crearRefreshToken,
  leerRefreshCookie,
  revocarRefresh,
  rotarRefresh,
} from './refresh.service.js';

const VENTANA_MS = 60_000;
const MAX_INTENTOS = 10;

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  passwordAlgo: string | null;
  estado: string;
};

@Injectable()
export class AuthService {
  /** Rate limit en memoria (etapa 1; Redis en etapa 2). Clave: ip + email. */
  private intentos = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private get db(): {
    user: {
      findUnique: (a: unknown) => Promise<UserRow | null>;
      update: (a: unknown) => Promise<unknown>;
    };
  } {
    return this.prisma as unknown as AuthService['db'];
  }

  async login(email: string, password: string, ip?: string): Promise<TokenPair> {
    this.verificarLimite(`${ip ?? 'sin-ip'}|${email.toLowerCase()}`);
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.estado !== 'ACTIVE') {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    const { ok, upgradedHash } = await verificarPassword(user.passwordHash, user.passwordAlgo, password);
    if (!ok) throw new UnauthorizedException('Credenciales inválidas');
    const datos: Record<string, unknown> = { lastLoginAt: new Date() };
    if (upgradedHash) {
      datos.passwordHash = upgradedHash;
      datos.passwordAlgo = 'argon2id';
    }
    await this.db.user.update({ where: { id: user.id }, data: datos }).catch(() => undefined);
    const access_token = await this.jwt.signAsync({ sub: user.id, email: user.email, mfa: 'ok' });
    const refreshCookie = await crearRefreshToken(this.prisma, 'clinic', user.id, ip);
    return { access_token, refreshCookie };
  }

  /** Rotación: el refresh presentado se revoca y se emite un par nuevo. */
  async refresh(req: { cookies?: Record<string, string> }, ip?: string): Promise<TokenPair> {
    const presentado = leerRefreshCookie(req);
    if (!presentado) throw new UnauthorizedException('Refresh ausente');
    const rotado = await rotarRefresh(this.prisma, this.jwt, 'clinic', presentado, (sub) => ({ sub }), ip);
    if (!rotado) throw new UnauthorizedException('Refresh inválido');
    return rotado;
  }

  async logout(req: { cookies?: Record<string, string> }): Promise<{ ok: true }> {
    const presentado = leerRefreshCookie(req);
    if (presentado) await revocarRefresh(this.prisma, presentado);
    return { ok: true as const };
  }

  /** Cambiar la clave invalida todos los tokens (passwordChangedAt, doc §8). */
  async cambiarClave(userId: string, actual: string, nueva: string): Promise<{ ok: true }> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Sesión no válida');
    const { ok } = await verificarPassword(user.passwordHash, user.passwordAlgo, actual);
    if (!ok) throw new UnauthorizedException('Clave actual incorrecta');
    try {
      validarPassword(nueva);
    } catch (e) {
      throw new HttpException((e as Error).message, HttpStatus.BAD_REQUEST);
    }
    await this.db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(nueva), passwordAlgo: 'argon2id', passwordChangedAt: new Date() },
    });
    await (this.prisma as unknown as {
      refreshToken: { updateMany: (a: unknown) => Promise<unknown> };
    }).refreshToken.updateMany({ where: { kind: 'clinic', userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true as const };
  }

  async hashPassword(plain: string): Promise<string> {
    return hashPassword(plain);
  }

  private verificarLimite(clave: string): void {
    const ahora = Date.now();
    const lista = (this.intentos.get(clave) ?? []).filter((t) => ahora - t < VENTANA_MS);
    if (lista.length >= MAX_INTENTOS) {
      throw new HttpException(
        'Demasiados intentos, intente en un minuto',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    lista.push(ahora);
    this.intentos.set(clave, lista);
  }
}

export { REFRESH_COOKIE };
