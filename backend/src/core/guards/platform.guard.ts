import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * PlatformGuard (Fase 6). Protege las rutas `@Platform()`: exige JWT de
 * plataforma (`platform: true`) y `PlatformUser` activo. Login de plataforma
 * separado del login de clínica (doc §14 Fase 1).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token de plataforma ausente');
    }
    let payload: { sub?: string; platform?: boolean; rol?: string; mfa?: string; iat?: number };
    try {
      payload = await this.jwt.verifyAsync(header.slice('Bearer '.length).trim());
    } catch {
      throw new UnauthorizedException('Token de plataforma inválido');
    }
    if (!payload?.sub || payload.platform !== true) {
      throw new UnauthorizedException('Token de plataforma inválido');
    }
    if (payload.mfa !== 'ok') {
      throw new UnauthorizedException('MFA pendiente');
    }
    const db = this.prisma as unknown as {
      platformUser: {
        findUnique: (a: unknown) => Promise<{
          id: string;
          activo: boolean;
          rol: string;
          passwordChangedAt: Date | null;
        } | null>;
      };
    };
    const owner = await db.platformUser.findUnique({ where: { id: payload.sub } });
    if (!owner || !owner.activo) throw new UnauthorizedException('Plataforma: sesión no válida');
    if (owner.passwordChangedAt && payload.iat && payload.iat * 1000 < owner.passwordChangedAt.getTime()) {
      throw new UnauthorizedException('Plataforma: sesión no válida');
    }
    req.platformUser = { id: owner.id, rol: owner.rol };
    return true;
  }
}
