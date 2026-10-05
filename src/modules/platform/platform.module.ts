import { Body, Controller, Get, HttpCode, Ip, Param, Patch, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import { BadRequestException, Injectable, Module, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import type { Request, Response } from 'express';
import { generarCodigoTotp, generarSecretoTotp, urlOtpauth, verificarTotp } from '../../core/auth/totp.js';
import { Platform } from '../../core/auth/platform.decorator.js';
import { Public } from '../../core/auth/public.decorator.js';
import { hashPassword, validarPassword, verificarPassword } from '../../core/auth/passwords.js';
import { PlatformGuard } from '../../core/guards/platform.guard.js';
import { EntitlementsService } from '../../core/entitlements/entitlements.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { LoginDto } from '../auth/login.dto.js';
import {
  CookieSpec,
  TokenPair,
  crearRefreshToken,
  emitirTemporalMfa,
  leerRefreshCookie,
  revocarRefresh,
  rotarRefresh,
} from '../auth/refresh.service.js';

export class UpsertSubscriptionDto {
  @IsString()
  tenantId!: string;

  @IsString()
  planCodigo!: string;

  @IsOptional()
  @IsIn(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED'])
  estado?: string;

  @IsOptional()
  @IsDateString()
  periodoInicio?: string;

  @IsOptional()
  @IsDateString()
  periodoFin?: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsIn(['ACTIVE', 'SUSPENDED', 'CANCELLED'])
  estado?: string;

  @IsOptional()
  @IsString()
  nombre?: string;
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private get db(): Record<string, { findUnique: (a: unknown) => Promise<Record<string, unknown> | null> } & Record<string, (a: unknown) => Promise<unknown>>> {
    return this.prisma as unknown as PlatformService['db'];
  }

  async login(
    dto: LoginDto,
    ip?: string,
  ): Promise<{ access_token: string; refreshCookie?: CookieSpec } | { mfa_required: true; temp_token: string }> {
    const u = (await this.db.platformUser.findUnique({ where: { email: dto.email } })) as unknown as {
      id: string;
      email: string;
      passwordHash: string;
      passwordAlgo: string | null;
      activo: boolean;
      rol: string;
      mfaEnabled: boolean;
    } | null;
    if (!u || !u.activo) throw new NotFoundException('Credenciales inválidas');
    const { ok, upgradedHash } = await verificarPassword(u.passwordHash, u.passwordAlgo, dto.password);
    if (!ok) throw new NotFoundException('Credenciales inválidas');
    if (upgradedHash) {
      await this.db.platformUser.update({
        where: { id: u.id },
        data: { passwordHash: upgradedHash, passwordAlgo: 'argon2id' },
      });
    }
    if (u.mfaEnabled) {
      const temp_token = await emitirTemporalMfa(this.jwt, { sub: u.id, platform: true, rol: u.rol });
      return { mfa_required: true as const, temp_token };
    }
    const access_token = await this.jwt.signAsync({ sub: u.id, platform: true, rol: u.rol, mfa: 'ok' });
    const refreshCookie = await crearRefreshToken(this.prisma, 'platform', u.id, ip);
    return { access_token, refreshCookie };
  }

  /** Verifica el TOTP contra un token temporal y emite el par completo. */
  async verificarMfa(tempToken: string, code: string, ip?: string): Promise<TokenPair> {
    let payload: { sub?: string; platform?: boolean; mfa?: string };
    try {
      payload = await this.jwt.verifyAsync(tempToken);
    } catch {
      throw new UnauthorizedException('MFA inválido');
    }
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
      throw new UnauthorizedException('Código MFA incorrecto');
    }
    const access_token = await this.jwt.signAsync({ sub: u.id, platform: true, rol: u.rol, mfa: 'ok' });
    const refreshCookie = await crearRefreshToken(this.prisma, 'platform', u.id, ip);
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
    } | null;
    const access_token = await this.jwt.signAsync({ sub: payload.sub, platform: true, rol: owner?.rol ?? 'soporte', mfa: 'ok' });
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
    return this.db.tenant.findMany({
      include: { suscripcion: { include: { plan: true } } },
      orderBy: { createdAt: 'desc' },
    } as unknown as object);
  }

  async tenant(id: string): Promise<unknown> {
    const t = await this.db.tenant.findUnique({
      where: { id },
      include: { suscripcion: { include: { plan: true } }, sedes: true },
    } as unknown as object);
    if (!t) throw new NotFoundException('Tenant no encontrado');
    return t;
  }

  async actualizarTenant(id: string, dto: UpdateTenantDto): Promise<unknown> {
    const t = await this.db.tenant.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Tenant no encontrado');
    return this.db.tenant.update({ where: { id }, data: dto });
  }

  async planes(): Promise<unknown> {
    return this.db.plan.findMany({
      include: { features: true },
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
      include: { suscripcion: { include: { plan: true } } },
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
@Controller('platform')
export class PlatformController {
  constructor(private readonly service: PlatformService) {}

  @Public()
  @Post('auth/login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access_token: string } | { mfa_required: true; temp_token: string }> {
    const r = await this.service.login(dto, ip);
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
    @Body() dto: { temp_token: string; code: string },
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access_token: string }> {
    const r = await this.service.verificarMfa(dto.temp_token, dto.code, ip);
    ponerCookiePlatform(res, r.refreshCookie);
    return { access_token: r.access_token };
  }

  @Post('auth/mfa/setup')
  @HttpCode(200)
  iniciarMfa(@Req() req: Request & { platformUser?: { id: string } }): Promise<{
    secret: string;
    otpauth_url: string;
  }> {
    return this.service.iniciarMfa(req.platformUser!.id);
  }

  @Post('auth/mfa/confirm')
  @HttpCode(200)
  confirmarMfa(
    @Req() req: Request & { platformUser?: { id: string } },
    @Body() dto: { code: string },
  ): Promise<{ mfaEnabled: true }> {
    return this.service.confirmarMfa(req.platformUser!.id, dto.code);
  }

  @Post('auth/mfa/disable')
  @HttpCode(200)
  deshabilitarMfa(
    @Req() req: Request & { platformUser?: { id: string } },
    @Body() dto: { password: string },
  ): Promise<{ mfaEnabled: false }> {
    return this.service.deshabilitarMfa(req.platformUser!.id, dto.password);
  }

  @Post('auth/cambiar-clave')
  @HttpCode(200)
  cambiarClave(
    @Req() req: Request & { platformUser?: { id: string } },
    @Body() dto: { actual: string; nueva: string },
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

  @Patch('tenants/:id')
  actualizarTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto): Promise<unknown> {
    return this.service.actualizarTenant(id, dto);
  }

  @Get('tenants/:id/metricas')
  metricas(@Param('id') id: string): Promise<unknown> {
    return this.service.metricas(id);
  }

  @Get('tenants/:id/export')
  exportar(@Param('id') id: string): Promise<unknown> {
    return this.service.exportar(id);
  }

  @Get('plans')
  planes(): Promise<unknown> {
    return this.service.planes();
  }

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
