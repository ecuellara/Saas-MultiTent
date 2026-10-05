import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PLATFORM_KEY } from '../auth/platform.decorator.js';
import { IS_PUBLIC_KEY } from '../auth/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const esPlataforma = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Las rutas de plataforma las protege PlatformGuard, no este guard.
    if (skip || esPlataforma) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente');
    }
    const token = header.slice('Bearer '.length).trim();
    let payload: { sub?: string; iat?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Token inválido');
    }
    if (!payload?.sub) throw new UnauthorizedException('Token inválido');

    type UserDelegate = {
      findUnique: (a: unknown) => Promise<{
        id: string;
        estado: string;
        passwordChangedAt: Date | null;
      } | null>;
    };
    const db = this.prisma as unknown as { user: UserDelegate };
    const user = await db.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.estado !== 'ACTIVE') {
      throw new UnauthorizedException('Sesión no válida');
    }
    // Cambio de clave invalida tokens previos (doc §8).
    if (user.passwordChangedAt && payload.iat && payload.iat * 1000 < user.passwordChangedAt.getTime()) {
      throw new UnauthorizedException('Sesión no válida');
    }
    req.user = { id: user.id, sub: user.id };
    return true;
  }
}
