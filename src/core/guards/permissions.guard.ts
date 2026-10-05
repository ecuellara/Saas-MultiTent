import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PLATFORM_KEY } from '../auth/platform.decorator.js';
import { IS_PUBLIC_KEY } from '../auth/public.decorator.js';
import { tenantContext } from '../tenant-context/tenant-context.js';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator.js';

/**
 * PermissionsGuard (Fase 5). Sin metadata deja pasar; con
 * `@RequirePermission(...)` exige todos los códigos. Responde 403.
 * El frontend oculta; este guard rechaza (regla de oro).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ||
      this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_KEY, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const requeridos =
      this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (requeridos.length === 0) return true;
    const ctx = tenantContext.getStore();
    const propios = new Set(ctx?.permissions ?? []);
    const faltantes = requeridos.filter((c) => !propios.has(c));
    if (faltantes.length > 0) {
      throw new ForbiddenException(`Permiso insuficiente: ${faltantes.join(', ')}`);
    }
    return true;
  }
}
