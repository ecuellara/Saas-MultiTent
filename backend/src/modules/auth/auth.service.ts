import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EntitlementsService } from '../../core/entitlements/entitlements.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { hashPassword, validarPassword, verificarPassword } from '../../core/auth/passwords.js';
import {
  LimitadorIntentos,
  VENTANA_INTENTOS_MS,
  reglasLogin,
} from '../../core/auth/rate-limit.js';
import {
  REFRESH_COOKIE,
  TokenPair,
  crearRefreshToken,
  leerRefreshCookie,
  revocarRefresh,
  rotarRefresh,
} from './refresh.service.js';

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  passwordAlgo: string | null;
  estado: string;
};

/** Datos públicos del usuario en la sesión: NUNCA credenciales ni MFA. */
export interface SesionUsuario {
  id: string;
  email: string;
  nombre: string;
  cop: string | null;
}

/** Clínica del usuario con el rol y la sede que tiene EN esa clínica. */
export interface SesionTenant {
  id: string;
  nombre: string;
  slug: string;
  /** Código del rol en esa clínica (`ADMIN`, `RECEP`, …), no el `roleId`. */
  rol: string;
  sedeId: string | null;
}

/** Clínica activa (la de `X-Tenant-Id`) con permisos y features del plan. */
export interface SesionActivo {
  tenantId: string;
  rol: string;
  sedeId: string | null;
  /** Códigos de permiso del rol (`patients.read`, …), como los carga el guard. */
  permissions: string[];
  /** Features del plan vigente; `{}` si el tenant no tiene suscripción. */
  features: Record<string, { habilitado: boolean; limite: number | null }>;
}

/** Contrato de `GET /api/auth/sesion`. */
export interface Sesion {
  usuario: SesionUsuario;
  tenants: SesionTenant[];
  activo: SesionActivo | null;
}

/** Fila de membresía con la clínica y el rol ya resueltos (lectura anidada). */
type MembershipSesion = {
  tenantId: string;
  roleId: string;
  sedeId: string | null;
  tenant: { id: string; nombre: string; slug: string; estado: string; deletedAt: Date | null };
  role: { codigo: string };
};

type DbSesion = {
  user: {
    findUnique: (a: unknown) => Promise<{
      id: string;
      email: string;
      nombre: string;
      cop: string | null;
      memberships: MembershipSesion[];
    } | null>;
  };
  rolePermission: {
    findMany: (a: unknown) => Promise<Array<{ permission: { codigo: string } }>>;
  };
};

@Injectable()
export class AuthService {
  /**
   * Rate limit de login en memoria (etapa 1; Redis en etapa 2, doc §8.2).
   * Contadores independientes por IP y por email.
   */
  private readonly limite = new LimitadorIntentos(VENTANA_INTENTOS_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly entitlements: EntitlementsService,
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
    this.limite.consumir(reglasLogin(ip, email));
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

  /**
   * Sesión del usuario (`GET /auth/sesion`): quién es, a qué clínicas pertenece
   * y —si se declara `X-Tenant-Id`— los permisos y features de esa clínica.
   *
   * Se consulta POR USUARIO (`userId` explícito) y NO por tenant: la ruta lleva
   * `@TenantOpcional()`, así que en la petición sin cabecera el `TenantContext`
   * queda sin validar y la extensión Prisma NO filtra. Además la lectura se hace
   * desde `User` (modelo global, fuera de `TENANT_MODELS`): así la lista de
   * clínicas no se recorta a la clínica de la cabecera —que es justamente lo que
   * el selector necesita— ni depende de que el contexto esté validado.
   *
   * @param tenantId clínica declarada en `X-Tenant-Id`; si falta, `activo: null`.
   * @throws UnauthorizedException si el usuario no existe (token de un borrado).
   * @throws ForbiddenException 403 si el usuario no tiene membresía en `tenantId`.
   */
  async sesion(userId: string, tenantId?: string): Promise<Sesion> {
    const db = this.prisma as unknown as DbSesion;
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        nombre: true,
        cop: true,
        memberships: {
          where: { estado: 'ACTIVE' },
          orderBy: { joinedAt: 'asc' },
          select: {
            tenantId: true,
            roleId: true,
            sedeId: true,
            tenant: {
              select: { id: true, nombre: true, slug: true, estado: true, deletedAt: true },
            },
            role: { select: { codigo: true } },
          },
        },
      },
    });
    if (!user) throw new UnauthorizedException('Sesión no válida');

    // Membresías ACTIVE de clínicas ACTIVE y no dadas de baja. Se filtran aquí
    // (y no en el `where` anidado) porque `estado`/`deletedAt` viven en `Tenant`.
    const membresias = user.memberships.filter(
      (m) => m.tenant.estado === 'ACTIVE' && m.tenant.deletedAt === null,
    );

    const usuario: SesionUsuario = {
      id: user.id,
      email: user.email,
      nombre: user.nombre,
      cop: user.cop,
    };
    const tenants: SesionTenant[] = membresias.map((m) => ({
      id: m.tenant.id,
      nombre: m.tenant.nombre,
      slug: m.tenant.slug,
      rol: m.role.codigo,
      sedeId: m.sedeId,
    }));

    // Sin cabecera: el frontend todavía no ha elegido clínica (selector).
    if (!tenantId) return { usuario, tenants, activo: null };

    const activa = membresias.find((m) => m.tenantId === tenantId);
    if (!activa) throw new ForbiddenException('Sin membresía en este tenant');

    // Permisos del rol y features del plan son independientes entre sí.
    const [permissions, ent] = await Promise.all([
      this.permisosDelRol(activa.roleId),
      this.entitlements.resolver(tenantId),
    ]);

    return {
      usuario,
      tenants,
      activo: {
        tenantId,
        rol: activa.role.codigo,
        sedeId: activa.sedeId,
        permissions,
        // Sin suscripción `resolver` devuelve `null` y no hay features que mostrar.
        features: ent?.features ?? {},
      },
    };
  }

  /** Códigos de permiso del rol, en el mismo formato que carga `TenantGuard`. */
  private async permisosDelRol(roleId: string): Promise<string[]> {
    const db = this.prisma as unknown as DbSesion;
    const filas = await db.rolePermission.findMany({
      where: { roleId },
      // Invariante 3: solo el código viaja (nunca la fila completa).
      select: { permission: { select: { codigo: true } } },
    });
    return filas.map((f) => f.permission.codigo);
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
}

export { REFRESH_COOKIE };
