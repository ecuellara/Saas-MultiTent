import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Module, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsDateString, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { generarCodigoTotp, generarSecretoTotp, urlOtpauth, verificarTotp } from '../../core/auth/totp.js';
import { Platform } from '../../core/auth/platform.decorator.js';
import { Public } from '../../core/auth/public.decorator.js';
import { hashPassword, validarPassword, verificarPassword } from '../../core/auth/passwords.js';
import {
  LimitadorIntentos,
  VENTANA_INTENTOS_MS,
  reglasLogin,
  reglasMfa,
} from '../../core/auth/rate-limit.js';
import { PermitirAltaMfa, PlatformGuard, PlatformRoles } from '../../core/guards/platform.guard.js';
import { EntitlementsService } from '../../core/entitlements/entitlements.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { LoginDto } from '../auth/login.dto.js';
import { CATALOGO_PERMISOS } from '../../core/catalogo/permisos.js';
import {
  CookieSpec,
  TokenPair,
  crearRefreshToken,
  emitirTemporalAltaMfa,
  emitirTemporalMfa,
  leerRefreshCookie,
  revocarRefresh,
  rotarRefresh,
} from '../auth/refresh.service.js';

/**
 * DTO de los endpoints de MFA y de clave del panel de plataforma.
 *
 * Antes estos cuerpos se declaraban como **tipo literal** (`@Body() dto: { code: string }`),
 * y con eso el `ValidationPipe` global **no valida nada**: el metatipo que emite
 * TypeScript para un objeto literal es `Object`, y el pipe solo valida cuando el
 * metatipo es una clase con decoradores. Consecuencia real comprobada:
 * `POST /platform/auth/mfa/verify` —que es `@Public()`— con `code: 123456`
 * (número) o sin `code` llegaba hasta `verificarTotp`, que hace
 * `code.replace(...)`, y devolvía un **500** en lugar de un 400.
 */
export class MfaVerifyDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  temp_token!: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code debe ser de 6 dígitos' })
  code!: string;
}

export class MfaCodeDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'code debe ser de 6 dígitos' })
  code!: string;
}

export class MfaDisableDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class CambiarClavePlatformDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  actual!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @IsNotEmpty()
  nueva!: string;
}

export class UpsertSubscriptionDto {
  @ApiProperty()
  @IsString()
  tenantId!: string;

  @ApiProperty({ example: 'clinica' })
  @IsString()
  planCodigo!: string;

  @ApiPropertyOptional({ enum: ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'] })
  @IsOptional()
  @IsIn(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'])
  estado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  periodoInicio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  periodoFin?: string;
}

export class UpdateTenantDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED', 'CANCELLED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED', 'CANCELLED'])
  estado?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nombre?: string;
}

/**
 * Alta completa de clínica (Fase 6 §14).
 *
 * DTO como CLASE con decoradores (invariante 2): un objeto literal haría que
 * el ValidationPipe no validara nada (metatipo `Object`).
 */
export class CreateTenantDto {
  @ApiProperty({ example: 'clinica-norte' })
  @IsString()
  @Matches(/^[a-z0-9-]{3,40}$/, { message: 'slug debe ser minúsculas, números y guiones (3-40)' })
  slug!: string;

  @ApiProperty({ example: 'Clínica Norte' })
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  razonSocial?: string;

  @ApiProperty({ example: 'clinica' })
  @IsString()
  @IsNotEmpty()
  planCodigo!: string;

  @ApiPropertyOptional({ example: 'Sede principal' })
  @IsOptional()
  @IsString()
  sedeNombre?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  ownerNombre!: string;

  @ApiProperty()
  @IsEmail()
  ownerEmail!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @MinLength(12, { message: 'la contraseña del dueño debe tener al menos 12 caracteres' })
  ownerPassword!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ownerCop?: string;
}

/** Resultado del login de plataforma: sesión plena, alta de MFA o MFA pendiente. */
export type ResultadoLoginPlataforma =
  | { access_token: string; refreshCookie: CookieSpec }
  | { mfa_required: true; temp_token: string }
  | { mfa_required: true; mfa_setup_required: true; temp_token: string };

/** Resultados admitidos por `PlatformAuditLog.metadata.resultado`. */
type ResultadoAuditoria = 'SUCCESS' | 'FAILURE';

/** Forma mínima del cliente Prisma que usa la auditoría de plataforma. */
interface ClienteAuditoria {
  platformAuditLog: { create: (a: { data: unknown }) => Promise<unknown> };
}

@Injectable()
export class PlatformService {
  /**
   * Rate limit en memoria (etapa 1; Redis en etapa 2, doc §8.2): contadores
   * independientes por IP y por identificador. Cubre el login de plataforma y
   * el paso MFA (6 dígitos → fuerza bruta viable dentro de los 5 min del
   * temp_token si no se limita).
   */
  private readonly limite = new LimitadorIntentos(VENTANA_INTENTOS_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private get db(): Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> } & Record<string, (a: unknown) => Promise<unknown>>> {
    return this.prisma as unknown as PlatformService['db'];
  }

  /**
   * Auditoría de plataforma (doc §10). `/platform/auth/*` es `@Public`, así que
   * el `AuditInterceptor` global no puede resolver el `platformUserId` y esas
   * acciones se perderían: las escribe el propio servicio en `PlatformAuditLog`.
   *
   * Nunca rompe la petición: cualquier fallo de escritura se traga (igual que
   * el interceptor). `platformUserId` es NOT NULL con FK, por lo que un intento
   * con email inexistente no se puede registrar en esta tabla.
   */
  private async auditar(
    platformUserId: string,
    datos: {
      accion: string;
      recurso: string;
      ip?: string;
      userAgent?: string;
      resultado: ResultadoAuditoria;
      detalle?: string;
    },
  ): Promise<void> {
    try {
      const db = this.prisma as unknown as ClienteAuditoria;
      await db.platformAuditLog.create({
        data: {
          platformUserId,
          accion: datos.accion,
          recurso: datos.recurso,
          recursoId: null,
          metadata: { resultado: datos.resultado, ...(datos.detalle ? { detalle: datos.detalle } : {}) },
          ip: datos.ip ?? null,
          userAgent: datos.userAgent ?? null,
        },
      });
    } catch {
      // Traga el error a propósito: la auditoría no puede tumbar la petición.
    }
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string): Promise<ResultadoLoginPlataforma> {
    this.limite.consumir(reglasLogin(ip, dto.email));
    const u = (await this.db.platformUser.findUnique({ where: { email: dto.email } })) as unknown as {
      id: string;
      email: string;
      passwordHash: string;
      passwordAlgo: string | null;
      activo: boolean;
      rol: string;
      mfaEnabled: boolean;
    } | null;
    // Email inexistente: no hay `platformUserId` que registrar (FK NOT NULL).
    if (!u) throw new NotFoundException('Credenciales inválidas');
    if (!u.activo) {
      await this.auditar(u.id, {
        accion: 'POST /api/platform/auth/login',
        recurso: 'platformUser',
        ip,
        userAgent,
        resultado: 'FAILURE',
        detalle: 'Usuario inactivo',
      });
      throw new NotFoundException('Credenciales inválidas');
    }
    const { ok, upgradedHash } = await verificarPassword(u.passwordHash, u.passwordAlgo, dto.password);
    if (!ok) {
      await this.auditar(u.id, {
        accion: 'POST /api/platform/auth/login',
        recurso: 'platformUser',
        ip,
        userAgent,
        resultado: 'FAILURE',
        detalle: 'Credenciales inválidas',
      });
      throw new NotFoundException('Credenciales inválidas');
    }
    if (upgradedHash) {
      await this.db.platformUser.update({
        where: { id: u.id },
        data: { passwordHash: upgradedHash, passwordAlgo: 'argon2id' },
      });
    }
    if (u.mfaEnabled) {
      await this.auditar(u.id, {
        accion: 'POST /api/platform/auth/login',
        recurso: 'platformUser',
        ip,
        userAgent,
        resultado: 'SUCCESS',
        detalle: 'Credenciales válidas, MFA pendiente',
      });
      const temp_token = await emitirTemporalMfa(this.jwt, { sub: u.id, platform: true, rol: u.rol });
      return { mfa_required: true as const, temp_token };
    }
    // Fail-closed (ADR-004/§8): sin TOTP enrolado NO se emite sesión plena. Se
    // devuelve un temp_token de alta (`mfa: 'setup'`) que solo sirve para
    // /platform/auth/mfa/setup y /platform/auth/mfa/confirm.
    await this.auditar(u.id, {
      accion: 'POST /api/platform/auth/login',
      recurso: 'platformUser',
      ip,
      userAgent,
      resultado: 'SUCCESS',
      detalle: 'Credenciales válidas, alta de MFA requerida',
    });
    const temp_token = await emitirTemporalAltaMfa(this.jwt, {
      sub: u.id,
      platform: true,
      rol: u.rol,
    });
    return { mfa_required: true as const, mfa_setup_required: true as const, temp_token };
  }

  /** Verifica el TOTP contra un token temporal y emite el par completo. */
  async verificarMfa(
    tempToken: string,
    code: string,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenPair> {
    let payload: { sub?: string; platform?: boolean; mfa?: string } | null = null;
    try {
      payload = await this.jwt.verifyAsync(tempToken);
    } catch {
      payload = null;
    }
    // Límite estricto (5/min por IP y por usuario) antes de comprobar el TOTP.
    const identificador =
      payload?.platform === true && payload.mfa === 'pending' ? (payload.sub ?? 'sin-usuario') : 'sin-sesion';
    this.limite.consumir(
      reglasMfa(ip, identificador),
      'Demasiados intentos de MFA. Vuelva a intentarlo en un minuto.',
    );
    if (!payload?.sub || payload.platform !== true || payload.mfa !== 'pending') {
      throw new UnauthorizedException('MFA inválido');
    }
    const u = (await this.db.platformUser.findUnique({ where: { id: payload.sub } })) as unknown as {
      id: string;
      activo: boolean;
      rol: string;
      mfaEnabled: boolean;
      mfaSecret: string | null;
    } | null;
    if (!u || !u.activo || !u.mfaEnabled || !u.mfaSecret) throw new UnauthorizedException('MFA inválido');
    if (!(await verificarTotp(u.mfaSecret, code))) {
      await this.auditar(u.id, {
        accion: 'POST /api/platform/auth/mfa/verify',
        recurso: 'platformUser',
        ip,
        userAgent,
        resultado: 'FAILURE',
        detalle: 'Código MFA incorrecto',
      });
      throw new UnauthorizedException('Código MFA incorrecto');
    }
    const access_token = await this.jwt.signAsync({ sub: u.id, platform: true, rol: u.rol, mfa: 'ok' });
    const refreshCookie = await crearRefreshToken(this.prisma, 'platform', u.id, ip);
    await this.auditar(u.id, {
      accion: 'POST /api/platform/auth/mfa/verify',
      recurso: 'platformUser',
      ip,
      userAgent,
      resultado: 'SUCCESS',
      detalle: 'MFA verificado',
    });
    return { access_token, refreshCookie };
  }

  /** Inicia el alta MFA (requiere sesión plena): devuelve secreto + URL otpauth. */
  async iniciarMfa(platformUserId: string): Promise<{ secret: string; otpauth_url: string }> {
    const secret = generarSecretoTotp();
    await this.db.platformUser.update({ where: { id: platformUserId }, data: { mfaSecret: secret } });
    const u = (await this.db.platformUser.findUnique({ where: { id: platformUserId } })) as unknown as {
      email: string;
    };
    return { secret, otpauth_url: urlOtpauth(u.email, secret) };
  }

  async confirmarMfa(platformUserId: string, code: string): Promise<{ mfaEnabled: true }> {
    const u = (await this.db.platformUser.findUnique({ where: { id: platformUserId } })) as unknown as {
      mfaSecret: string | null;
    } | null;
    if (!u?.mfaSecret || !(await verificarTotp(u.mfaSecret, code))) {
      throw new UnauthorizedException('Código MFA incorrecto');
    }
    await this.db.platformUser.update({ where: { id: platformUserId }, data: { mfaEnabled: true } });
    return { mfaEnabled: true as const };
  }

  async deshabilitarMfa(platformUserId: string, password: string): Promise<{ mfaEnabled: false }> {
    const u = (await this.db.platformUser.findUnique({ where: { id: platformUserId } })) as unknown as {
      passwordHash: string;
      passwordAlgo: string | null;
    } | null;
    if (!u) throw new UnauthorizedException('Sesión no válida');
    const { ok } = await verificarPassword(u.passwordHash, u.passwordAlgo, password);
    if (!ok) throw new UnauthorizedException('Clave incorrecta');
    await this.db.platformUser.update({
      where: { id: platformUserId },
      data: { mfaEnabled: false, mfaSecret: null },
    });
    return { mfaEnabled: false as const };
  }

  async refresh(req: { cookies?: Record<string, string> }, ip?: string): Promise<TokenPair> {
    const presentado = leerRefreshCookie(req);
    if (!presentado) throw new UnauthorizedException('Refresh ausente');
    const rotado = await rotarRefresh(this.prisma, this.jwt, 'platform', presentado, (sub) => ({ sub }), ip);
    if (!rotado) throw new UnauthorizedException('Refresh inválido');
    // Completa el payload de plataforma (rol) tras rotar.
    const payload = await this.jwt.verifyAsync<{ sub: string }>(rotado.access_token);
    const owner = (await this.db.platformUser.findUnique({ where: { id: payload.sub } })) as unknown as {
      rol: string;
      activo: boolean;
      mfaEnabled: boolean;
    } | null;
    if (!owner?.activo || !owner.mfaEnabled) {
      // Fail-closed: tampoco el refresh puede emitir sesión plena sin TOTP
      // enrolado (si no, deshabilitar MFA sería un atajo al panel).
      await revocarRefresh(this.prisma, rotado.refreshCookie.value);
      throw new UnauthorizedException('MFA no configurada');
    }
    const access_token = await this.jwt.signAsync({ sub: payload.sub, platform: true, rol: owner.rol, mfa: 'ok' });
    return { access_token, refreshCookie: rotado.refreshCookie };
  }

  async logout(req: { cookies?: Record<string, string> }): Promise<{ ok: true }> {
    const presentado = leerRefreshCookie(req);
    if (presentado) await revocarRefresh(this.prisma, presentado);
    return { ok: true as const };
  }

  async cambiarClavePropia(platformUserId: string, actual: string, nueva: string): Promise<{ ok: true }> {
    const u = (await this.db.platformUser.findUnique({ where: { id: platformUserId } })) as unknown as {
      passwordHash: string;
      passwordAlgo: string | null;
    } | null;
    if (!u) throw new UnauthorizedException('Sesión no válida');
    const { ok } = await verificarPassword(u.passwordHash, u.passwordAlgo, actual);
    if (!ok) throw new UnauthorizedException('Clave actual incorrecta');
    try {
      validarPassword(nueva);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    await this.db.platformUser.update({
      where: { id: platformUserId },
      data: { passwordHash: await hashPassword(nueva), passwordAlgo: 'argon2id', passwordChangedAt: new Date() },
    });
    await (this.prisma as unknown as {
      refreshToken: { updateMany: (a: unknown) => Promise<unknown> };
    }).refreshToken.updateMany({
      where: { kind: 'platform', userId: platformUserId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true as const };
  }

  async tenants(): Promise<unknown> {
    // Invariante 3: `select` explícito en toda relación (nunca `include: true`).
    return this.db.tenant.findMany({
      select: {
        id: true, slug: true, nombre: true, razonSocial: true, estado: true,
        createdAt: true, updatedAt: true, deletedAt: true,
        suscripcion: {
          select: {
            id: true, tenantId: true, planId: true, estado: true, iniciadaEn: true,
            periodoInicio: true, periodoFin: true, canceladaEn: true,
            createdAt: true, updatedAt: true,
            plan: {
              select: {
                id: true, codigo: true, nombre: true, descripcion: true,
                precioMensual: true, moneda: true, activo: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    } as unknown as object);
  }

  async tenant(id: string): Promise<unknown> {
    const t = await this.db.tenant.findUnique({
      where: { id },
      select: {
        id: true, slug: true, nombre: true, razonSocial: true, estado: true,
        createdAt: true, updatedAt: true, deletedAt: true,
        suscripcion: {
          select: {
            id: true, tenantId: true, planId: true, estado: true, iniciadaEn: true,
            periodoInicio: true, periodoFin: true, canceladaEn: true,
            createdAt: true, updatedAt: true,
            plan: {
              select: {
                id: true, codigo: true, nombre: true, descripcion: true,
                precioMensual: true, moneda: true, activo: true,
              },
            },
          },
        },
        sedes: {
          select: {
            id: true, tenantId: true, nombre: true, direccion: true, telefono: true,
            esPrincipal: true, createdAt: true, deletedAt: true,
          },
        },
      },
    } as unknown as object);
    if (!t) throw new NotFoundException('Tenant no encontrado');
    return t;
  }

  async actualizarTenant(id: string, dto: UpdateTenantDto): Promise<unknown> {
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tenant no encontrado');
    return this.db.tenant.update({ where: { id }, data: dto });
  }

  /**
   * Alta completa de clínica EN UNA TRANSACCIÓN (Fase 6 §14): Tenant +
   * TenantConfig + Sede principal + Rol ADMIN (permisos del catálogo) + User
   * dueño (clave por parámetro, nunca por defecto — bloqueador #2) +
   * Membership + Subscription al plan indicado.
   *
   * Sobre `crearConLimite`: ese patrón serializa altas DENTRO de un tenant ya
   * existente (lock de su fila). Aquí el tenant aún no existe, así que no hay
   * fila que bloquear; la atomicidad la da esta única transacción y el primer
   * miembro no puede superar ningún límite. Los límites rigen desde la
   * siguiente alta (vía `MembershipsService`/`UsuariosService`).
   *
   * Conflictos de slug/email → 409, nunca 500: se comprueba antes y, por la
   * carrera entre comprobación e inserción, el `P2002` también se traduce.
   */
  async crearTenant(dto: CreateTenantDto): Promise<Record<string, unknown>> {
    try {
      validarPassword(dto.ownerPassword);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const slugEnUso = await this.db.tenant.findUnique({ where: { slug: dto.slug } });
    if (slugEnUso) throw new ConflictException('Slug en uso');
    const emailEnUso = await this.db.user.findUnique({ where: { email: dto.ownerEmail } });
    if (emailEnUso) throw new ConflictException('Email en uso');
    const planes = (await this.db.plan.findMany({ where: { codigo: dto.planCodigo } } as unknown as object)) as Array<{
      id: string;
    }>;
    const plan = planes[0];
    if (!plan) throw new BadRequestException('Plan desconocido');
    const permisos = (await this.db.permission.findMany({
      where: { codigo: { in: CATALOGO_PERMISOS.map((p) => p.codigo) } },
    } as unknown as object)) as Array<{ id: string }>;
    if (permisos.length !== CATALOGO_PERMISOS.length) {
      throw new InternalServerErrorException('Catálogo de permisos incompleto: ejecute db:seed');
    }

    const passwordHash = await hashPassword(dto.ownerPassword);
    const ahora = new Date();
    const fin = new Date(ahora);
    fin.setDate(fin.getDate() + 30);
    const nombreSede = dto.sedeNombre?.trim() || 'Sede principal';

    try {
      return await this.prisma.$transaction(async (tx) => {
        const t = tx as unknown as {
          tenant: { create: (a: unknown) => Promise<{ id: string }> };
          tenantConfig: { create: (a: unknown) => Promise<unknown> };
          sede: { create: (a: unknown) => Promise<{ id: string }> };
          role: { create: (a: unknown) => Promise<{ id: string }> };
          rolePermission: { createMany: (a: unknown) => Promise<unknown> };
          user: { create: (a: unknown) => Promise<{ id: string; email: string }> };
          membership: { create: (a: unknown) => Promise<unknown> };
          subscription: { create: (a: unknown) => Promise<unknown> };
        };
        const tenant = await t.tenant.create({
          data: {
            slug: dto.slug,
            nombre: dto.nombre,
            razonSocial: dto.razonSocial ?? null,
            estado: 'ACTIVE',
          },
        });
        await t.tenantConfig.create({
          data: { tenantId: tenant.id, nombre: dto.nombre, ciudad: 'Huancayo' },
        });
        const sede = await t.sede.create({
          data: { tenantId: tenant.id, nombre: nombreSede, esPrincipal: true },
        });
        const role = await t.role.create({
          data: { tenantId: tenant.id, codigo: 'ADMIN', nombre: 'Administrador', esSistema: true },
        });
        await t.rolePermission.createMany({
          data: permisos.map((p) => ({ roleId: role.id, permissionId: p.id })),
        });
        const owner = await t.user.create({
          data: {
            email: dto.ownerEmail,
            passwordHash,
            passwordAlgo: 'argon2id',
            nombre: dto.ownerNombre,
            cop: dto.ownerCop ?? null,
          },
        });
        await t.membership.create({
          data: { tenantId: tenant.id, userId: owner.id, roleId: role.id, sedeId: sede.id },
        });
        await t.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            estado: 'ACTIVE',
            periodoInicio: ahora,
            periodoFin: fin,
          },
        });
        // Respuesta explícita, sin hashes ni secretos (invariante 3).
        return {
          id: tenant.id,
          slug: dto.slug,
          nombre: dto.nombre,
          sede: { id: sede.id, nombre: nombreSede },
          owner: { id: owner.id, email: owner.email },
          plan: dto.planCodigo,
        };
      });
    } catch (e) {
      if (
        e !== null &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException('Slug o email en uso');
      }
      throw e;
    }
  }

  async planes(): Promise<unknown> {
    return this.db.plan.findMany({
      select: {
        id: true, codigo: true, nombre: true, descripcion: true,
        precioMensual: true, moneda: true, activo: true,
        createdAt: true, updatedAt: true,
        features: {
          select: { id: true, planId: true, clave: true, habilitado: true, limite: true },
        },
      },
      orderBy: { precioMensual: 'asc' },
    } as unknown as object);
  }

  /** Facturación manual etapa 1 (ADR-008): la plataforma asigna el plan. */
  async upsertSubscription(dto: UpsertSubscriptionDto): Promise<unknown> {
    const tenant = await this.db.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant no encontrado');
    const planes = (await this.db.plan.findMany({ where: { codigo: dto.planCodigo } } as unknown as object)) as Array<{ id: string }>;
    const plan = planes[0];
    if (!plan) throw new BadRequestException('Plan desconocido');
    const ahora = new Date();
    const fin = new Date(ahora);
    fin.setDate(fin.getDate() + 30);
    const data = {
      tenantId: dto.tenantId,
      planId: plan.id,
      estado: dto.estado ?? 'ACTIVE',
      periodoInicio: dto.periodoInicio ? new Date(dto.periodoInicio) : ahora,
      periodoFin: dto.periodoFin ? new Date(dto.periodoFin) : fin,
    };
    const existente = await this.db.subscription.findUnique({ where: { tenantId: dto.tenantId } });
    const resultado = existente
      ? await this.db.subscription.update({ where: { tenantId: dto.tenantId }, data })
      : await this.db.subscription.create({ data });
    this.entitlements.invalidate(dto.tenantId);
    return resultado;
  }

  async metricas(tenantId: string): Promise<unknown> {
    const t = await this.db.tenant.findUnique({ where: { id: tenantId } });
    if (!t) throw new NotFoundException('Tenant no encontrado');
    const contar = async (modelo: string, where: object): Promise<number> =>
      (await (this.db[modelo] as unknown as { count: (a: unknown) => Promise<number> }).count({ where })) ?? 0;
    const [pacientes, citas, pagosPendientes, insumos, usuarios] = await Promise.all([
      contar('paciente', { tenantId }),
      contar('cita', { tenantId }),
      contar('pago', { tenantId, estado: { in: ['pendiente', 'parcial'] } }),
      contar('insumo', { tenantId }),
      contar('membership', { tenantId, estado: 'ACTIVE' }),
    ]);
    return { tenantId, pacientes, citas, pagosPendientes, insumos, usuarios };
  }

  /**
   * Export por tenant (offboarding, doc §12). Un JSON con todas las filas del
   * tenant (FKs por id conservados → re-importable) + manifiesto. Secretos
   * redactados: sin passwordHash, sin refresh tokens de Google ni de sesión.
   */
  async exportar(tenantId: string): Promise<Record<string, unknown>> {
    const t = await this.db.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true, slug: true, nombre: true, razonSocial: true, estado: true,
        createdAt: true, updatedAt: true, deletedAt: true,
        suscripcion: {
          select: {
            id: true, tenantId: true, planId: true, estado: true, iniciadaEn: true,
            periodoInicio: true, periodoFin: true, canceladaEn: true,
            createdAt: true, updatedAt: true,
            plan: {
              select: {
                id: true, codigo: true, nombre: true, descripcion: true,
                precioMensual: true, moneda: true, activo: true,
              },
            },
          },
        },
      },
    } as unknown as object);
    if (!t) throw new NotFoundException('Tenant no encontrado');
    const db = this.prisma as unknown as Record<
      string,
      { findMany: (a?: unknown) => Promise<Array<Record<string, unknown>>> }
    >;
    const plano = async (modelo: string): Promise<Array<Record<string, unknown>>> =>
      db[modelo].findMany({ where: { tenantId }, orderBy: { id: 'asc' } });
    const sin = (filas: Array<Record<string, unknown>>, ...claves: string[]) =>
      filas.map((f) => {
        const copia = { ...f };
        for (const k of claves) delete copia[k];
        return copia;
      });
    const memberships = await plano('membership');
    const userIds = [...new Set(memberships.map((m) => m.userId as string))];
    const usuarios = (
      (await db.user.findMany({ where: { id: { in: userIds } } })) as Array<Record<string, unknown>>
    ).map((u) => {
      const copia = { ...u };
      delete copia.passwordHash;
      delete copia.mfaSecret;
      return copia;
    });
    const tablas: Record<string, unknown> = {
      tenant: t,
      usuarios,
      sedes: await plano('sede'),
      memberships,
      roles: await plano('role'),
      pacientes: await plano('paciente'),
      especialidades: await plano('especialidad'),
      tratamientos: await plano('tratamiento'),
      citas: await plano('cita'),
      historiales: await plano('historialClinico'),
      documentos: await plano('documentoPaciente'),
      odontogramas: await plano('odontograma'),
      odontoHallazgos: await plano('odontogramaHallazgo'),
      odontoEventos: await plano('odontogramaEvento'),
      consentimientoPlantillas: await plano('consentimientoPlantilla'),
      consentimientos: await plano('consentimientoFirmado'),
      googleAccounts: sin(await plano('googleAccount'), 'refreshToken'),
      pagos: await plano('pago'),
      pagoDetalles: await plano('pagoDetalle'),
      cuotas: await plano('cuota'),
      proveedores: await plano('proveedor'),
      insumos: await plano('insumo'),
      movimientos: await plano('movimientoInventario'),
      compras: await plano('compra'),
      compraDetalles: await plano('compraDetalle'),
      tenantConfig: await plano('tenantConfig').catch(() => []),
      plantillasWhatsApp: await plano('plantillaWhatsApp'),
      cobros: await plano('cobroSuscripcion'),
      auditoria: await plano('auditoria'),
    };
    const conteos = Object.fromEntries(
      Object.entries(tablas).map(([k, v]) => [k, Array.isArray(v) ? v.length : 1]),
    );
    return { exportadoEn: new Date().toISOString(), tenantId, tablas, conteos };
  }
}

@Platform()
@UseGuards(PlatformGuard)
@ApiTags('platform')
@Controller('platform')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    { access_token: string } | { mfa_required: true; mfa_setup_required?: boolean; temp_token: string }
  > {
    const r = await this.service.login(dto, ip, userAgent);
    if ('refreshCookie' in r && r.refreshCookie) ponerCookiePlatform(res, r.refreshCookie);
    return 'refreshCookie' in r ? { access_token: r.access_token } : r;
  }

  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access_token: string }> {
    const r = await this.service.refresh(req, ip);
    ponerCookiePlatform(res, r.refreshCookie);
    return { access_token: r.access_token };
  }

  @Public()
  @Post('auth/logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const r = await this.service.logout(req);
    res.clearCookie('refresh_token', { path: '/api/platform/auth' });
    return r;
  }

  @Public()
  @Post('auth/mfa/verify')
  @HttpCode(200)
  async verificarMfa(
    @Body() dto: MfaVerifyDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access_token: string }> {
    const r = await this.service.verificarMfa(dto.temp_token, dto.code, ip, userAgent);
    ponerCookiePlatform(res, r.refreshCookie);
    return { access_token: r.access_token };
  }

  @PermitirAltaMfa()
  @Post('auth/mfa/setup')
  @HttpCode(200)
  iniciarMfa(@Req() req: Request & { platformUser?: { id: string } }): Promise<{
    secret: string;
    otpauth_url: string;
  }> {
    return this.service.iniciarMfa(req.platformUser!.id);
  }

  @PermitirAltaMfa()
  @Post('auth/mfa/confirm')
  @HttpCode(200)
  confirmarMfa(
    @Req() req: Request & { platformUser?: { id: string } },
    @Body() dto: MfaCodeDto,
  ): Promise<{ mfaEnabled: true }> {
    return this.service.confirmarMfa(req.platformUser!.id, dto.code);
  }

  @Post('auth/mfa/disable')
  @HttpCode(200)
  deshabilitarMfa(
    @Req() req: Request & { platformUser?: { id: string } },
    @Body() dto: MfaDisableDto,
  ): Promise<{ mfaEnabled: false }> {
    return this.service.deshabilitarMfa(req.platformUser!.id, dto.password);
  }

  @Post('auth/cambiar-clave')
  @HttpCode(200)
  cambiarClave(
    @Req() req: Request & { platformUser?: { id: string } },
    @Body() dto: CambiarClavePlatformDto,
  ): Promise<{ ok: true }> {
    return this.service.cambiarClavePropia(req.platformUser!.id, dto.actual, dto.nueva);
  }

  @Get('tenants')
  tenants(): Promise<unknown> {
    return this.service.tenants();
  }

  @Get('tenants/:id')
  tenant(@Param('id') id: string): Promise<unknown> {
    return this.service.tenant(id);
  }

  /** Solo `owner`: suspender/reactivar clínicas es una acción crítica (§8). */
  @PlatformRoles('owner')
  @Patch('tenants/:id')
  actualizarTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto): Promise<unknown> {
    return this.service.actualizarTenant(id, dto);
  }

  /** Solo `owner`: alta completa de clínica en una transacción (Fase 6 §14). */
  @PlatformRoles('owner')
  @Post('tenants')
  @HttpCode(201)
  crearTenant(@Body() dto: CreateTenantDto): Promise<unknown> {
    return this.service.crearTenant(dto);
  }

  @Get('tenants/:id/metricas')
  metricas(@Param('id') id: string): Promise<unknown> {
    return this.service.metricas(id);
  }

  /** Solo `owner`: exporta datos clínicos completos (offboarding, §12). */
  @PlatformRoles('owner')
  @Get('tenants/:id/export')
  exportar(@Param('id') id: string): Promise<unknown> {
    return this.service.exportar(id);
  }

  @Get('plans')
  planes(): Promise<unknown> {
    return this.service.planes();
  }

  /** Solo `owner`: cambiar el plan de una clínica (ADR-008). */
  @PlatformRoles('owner')
  @Put('subscriptions')
  upsertSubscription(@Body() dto: UpsertSubscriptionDto): Promise<unknown> {
    return this.service.upsertSubscription(dto);
  }
}

@Module({ controllers: [PlatformController], providers: [PlatformService] })
export class PlatformModule {}

function ponerCookiePlatform(res: Response, c: CookieSpec): void {
  res.cookie(c.name, c.value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: c.path,
    maxAge: c.maxAge * 1000,
  });
}
