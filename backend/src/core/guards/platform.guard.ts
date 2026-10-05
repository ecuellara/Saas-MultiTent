import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Clave de metadata del RBAC del panel de plataforma. */
export const PLATFORM_ROLES_KEY = 'platformRoles';

/**
 * RBAC del panel de plataforma (doc §8 nivel 5). Restringe la ruta a los roles
 * indicados (`owner` | `soporte` | `finanzas`). Sin decorador, la ruta queda
 * accesible a cualquier `PlatformUser` activo con MFA.
 */
export const PlatformRoles = (...roles: string[]) => SetMetadata(PLATFORM_ROLES_KEY, roles);

/** Clave de metadata de las rutas que aceptan el temp_token de alta de MFA. */
export const ALTA_MFA_PERMITIDA_KEY = 'platformAltaMfa';

/**
 * Marca las ÚNICAS rutas que aceptan el temp_token con `mfa: 'setup'`
 * (`/platform/auth/mfa/setup` y `/platform/auth/mfa/confirm`). En cualquier
 * otro endpoint ese claim se rechaza.
 */
export const PermitirAltaMfa = () => SetMetadata(ALTA_MFA_PERMITIDA_KEY, true);

/**
 * PlatformGuard (Fase 6). Protege las rutas `@Platform()`: exige JWT de
 * plataforma (`platform: true`), `PlatformUser` activo y **MFA enrolada**
 * (ADR-004: fallar cerrado, nunca fail-open).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const clase = context.getClass();
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, clase])) {
      return true;
    }
    const altaMfaPermitida =
      this.reflector.getAllAndOverride<boolean>(ALTA_MFA_PERMITIDA_KEY, [handler, clase]) === true;
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de plataforma ausente');
    }
    let payload: { sub?: string; platform?: boolean; mfa?: string; iat?: number };
    try {
      payload = await this.jwt.verifyAsync(header.slice('Bearer '.length).trim());
    } catch {
      throw new UnauthorizedException('Token de plataforma inválido');
    }
    if (!payload?.sub || payload.platform !== true) {
      throw new UnauthorizedException('Token de plataforma inválido');
    }
    const db = this.prisma as unknown as {
      platformUser: {
        findUnique: (a: unknown) => Promise<{
          id: string;
          activo: boolean;
          rol: string;
          mfaEnabled: boolean;
          passwordChangedAt: Date | null;
        } | null>;
      };
    };
    const owner = await db.platformUser.findUnique({ where: { id: payload.sub } });
    if (!owner || !owner.activo) throw new UnauthorizedException('Plataforma: sesión no válida');
    if (owner.passwordChangedAt && payload.iat && payload.iat * 1000 < owner.passwordChangedAt.getTime()) {
      throw new UnauthorizedException('Plataforma: sesión no válida');
    }
    if (payload.mfa === 'setup') {
      // temp_token de alta de TOTP: solo las rutas marcadas y solo mientras la
      // cuenta siga sin MFA (si ya la enroló, no puede reescribir el secreto).
      if (!altaMfaPermitida || owner.mfaEnabled) {
        throw new UnauthorizedException('MFA no configurada');
      }
    } else if (payload.mfa !== 'ok') {
      throw new UnauthorizedException('MFA pendiente');
    } else if (!owner.mfaEnabled) {
      // Fail-closed: sin TOTP enrolado no hay sesión plena del panel.
      throw new UnauthorizedException('MFA no configurada');
    }
    // RBAC (doc §8 nivel 5): el rol se resuelve en BD, no se confía en el claim.
    const rolesPermitidos = this.reflector.getAllAndOverride<string[]>(PLATFORM_ROLES_KEY, [
      handler,
      clase,
    ]);
    if (rolesPermitidos?.length && !rolesPermitidos.includes(owner.rol)) {
      throw new ForbiddenException('Rol de plataforma insuficiente');
    }
    req.platformUser = { id: owner.id, rol: owner.rol };
    return true;
  }
}
