import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Req, Res } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Request, Response } from 'express';
import { Public } from '../../core/auth/public.decorator.js';
import { TenantOpcional } from '../../core/auth/tenant-opcional.decorator.js';
import { AuthService, type Sesion } from './auth.service.js';
import { LoginDto } from './login.dto.js';
import type { CookieSpec } from './refresh.service.js';

export class CambiarClaveDto {
  @ApiProperty()
  @IsString()
  actual!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  nueva!: string;
}

/**
 * `X-Tenant-Id` normalizada: una cabecera ausente o en blanco se trata como
 * "sin clínica declarada", con el MISMO criterio que `TenantGuard` (que en una
 * ruta `@TenantOpcional()` deja pasar sin validar). Si guard y servicio
 * discreparan, una cabecera vacía daría 403 en el servicio tras haber pasado el
 * guard.
 */
function normalizarTenantId(valor?: string): string | undefined {
  const limpio = valor?.trim();
  return limpio ? limpio : undefined;
}

function ponerCookie(res: Response, c: CookieSpec): void {
  res.cookie(c.name, c.value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: c.path,
    maxAge: c.maxAge * 1000,
  });
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access_token: string }> {
    const r = await this.auth.login(dto.email, dto.password, ip);
    ponerCookie(res, r.refreshCookie);
    return { access_token: r.access_token };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access_token: string }> {
    const r = await this.auth.refresh(req, ip);
    ponerCookie(res, r.refreshCookie);
    return { access_token: r.access_token };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    const r = await this.auth.logout(req);
    res.clearCookie('refresh_token', { path: '/api/auth' });
    return r;
  }

  /**
   * Sesión del usuario: quién es, a qué clínicas pertenece y, si se declara
   * `X-Tenant-Id`, los permisos y features de esa clínica activa.
   *
   * NO es `@Public`: sin token válido responde 401. `X-Tenant-Id` es OPCIONAL
   * (`@TenantOpcional`): sin cabecera devuelve `activo: null` para que el
   * frontend muestre el selector de clínica; con una cabecera que no
   * corresponde al usuario, `TenantGuard` responde 403.
   */
  @Get('sesion')
  @TenantOpcional()
  sesion(
    @Req() req: Request & { user?: { id: string } },
    @Headers('x-tenant-id') cabecera?: string,
  ): Promise<Sesion> {
    return this.auth.sesion(req.user!.id, normalizarTenantId(cabecera));
  }

  /** Requiere X-Tenant-Id (guard global) aunque sea operación de cuenta. */
  @Post('cambiar-clave')
  @HttpCode(200)
  cambiarClave(
    @Req() req: Request & { user?: { id: string } },
    @Body() dto: CambiarClaveDto,
  ): Promise<{ ok: true }> {
    return this.auth.cambiarClave(req.user!.id, dto.actual, dto.nueva);
  }
}
