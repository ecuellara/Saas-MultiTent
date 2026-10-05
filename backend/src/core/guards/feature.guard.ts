import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PLATFORM_KEY } from '../auth/platform.decorator.js';
import { IS_PUBLIC_KEY } from '../auth/public.decorator.js';
import { tenantContext } from '../tenant-context/tenant-context.js';
import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { REQUIRE_FEATURE_KEY } from './require-feature.decorator.js';

/** FeatureGuard (Fase 5): aplica `@RequireFeature(...)` con EntitlementsService. */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
    const clave = this.reflector.getAllAndOverride<string>(REQUIRE_FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!clave) return true;
    const ctx = tenantContext.getStore();
    if (!ctx?.tenantId) return true;
    await this.entitlements.requireFeature(ctx.tenantId, clave);
    return true;
  }
}
