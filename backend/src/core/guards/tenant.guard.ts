import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PLATFORM_KEY } from '../auth/platform.decorator.js';
import { IS_PUBLIC_KEY } from '../auth/public.decorator.js';
import { IS_TENANT_OPCIONAL_KEY } from '../auth/tenant-opcional.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { tenantContext } from '../tenant-context/tenant-context.js';

/**
 * TenantGuard (ADR-003 / ADR-005).
 * - Resuelve el tenant activo desde `X-Tenant-Id` (el JWT lleva solo `sub`).
 * - Valida tenant ACTIVE y membresía ACTIVE.
 * - Fija el `TenantContext` con `enterWith` para toda la petición.
 * Responde 403 (no 404) cuando el vínculo usuario–clínica no existe:
 * no revela nada del recurso, solo del vínculo.
 * - En rutas `@TenantOpcional()` sin cabecera no valida nada y deja pasar con
 *   el contexto SIN validar.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const esPlataforma = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic || esPlataforma) return true;

    // `@TenantOpcional()`: la cabecera pasa a ser opcional, pero SOLO su
    // ausencia. Si viene, se valida como en cualquier otra ruta.
    const tenantOpcional = this.reflector.getAllAndOverride<boolean>(IS_TENANT_OPCIONAL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest();
    const tenantId: string | undefined =
      req.headers?.['x-tenant-id'] ?? req.headers?.['X-Tenant-Id'];

    // Cabecera ausente (o en blanco) en una ruta con tenant opcional: no hay
    // clínica que validar y se deja pasar. El store se queda como lo dejó
    // `TenantContextMiddleware`, es decir con `validado: false` (lo mismo que
    // en las rutas `@Public`), así que la extensión Prisma NO filtra nada.
    // Consecuencia obligatoria para quien consuma esa ruta: debe acotar sus
    // consultas con el `userId` (o el `tenantId`) explícitos, sin confiar en la
    // extensión. El token ya lo validó `JwtAuthGuard`, que corre antes.
    const sinCabecera =
      tenantId === undefined || (typeof tenantId === 'string' && tenantId.trim() === '');
    if (tenantOpcional && sinCabecera) return true;

    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
      throw new BadRequestException('Cabecera X-Tenant-Id requerida');
    }
    const userId: string | undefined = req.user?.id ?? req.user?.sub;
    if (!userId) throw new ForbiddenException('Sin contexto de usuario');

    const db = this.prisma as unknown as {
      tenant: { findUnique: (a: unknown) => Promise<{ id: string; estado: string } | null> };
      subscription: {
        findUnique: (a: unknown) => Promise<{ estado: string } | null>;
      };
      membership: {
        findUnique: (a: unknown) => Promise<{
          roleId: string;
          sedeId: string | null;
          estado: string;
        } | null>;
      };
      rolePermission: {
        findMany: (a: unknown) => Promise<Array<{ permission: { codigo: string } }>>;
      };
    };

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant || tenant.estado !== 'ACTIVE') {
      // 403 honesto: el problema es el vínculo/tenant declarado, no un recurso.
      throw new ForbiddenException('Tenant no disponible');
    }
    // Dunning (Fase 8): suscripción cortada bloquea al tenant; PAST_DUE es gracia.
    // Sin suscripción no restringe (periodo previo a facturación).
    const sub = await db.subscription.findUnique({ where: { tenantId } });
    if (sub && ['SUSPENDED', 'CANCELLED', 'EXPIRED'].includes(sub.estado)) {
      throw new ForbiddenException('Suscripción no vigente');
    }
    const membership = await db.membership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (!membership || membership.estado !== 'ACTIVE') {
      throw new ForbiddenException('Sin membresía en este tenant');
    }

    let permissions: string[] = [];
    try {
      const rows = await db.rolePermission.findMany({
        where: { roleId: membership.roleId },
        include: { permission: true },
      });
      permissions = rows.map((r) => r.permission.codigo);
    } catch {
      permissions = [];
    }

    // Puebla el store creado por TenantContextMiddleware (mismo objeto para
    // toda la petición). No se usa `enterWith` aquí: fijaría el store en el
    // subcontexto del propio guard, invisible para los hops hermanos.
    const store = tenantContext.getStore();
    const poblado = {
      tenantId,
      userId,
      roleIds: [membership.roleId],
      permissions,
      sedeId: membership.sedeId ?? undefined,
      // Solo aquí el contexto pasa a ser de confianza: la extensión Prisma
      // únicamente filtra con `validado === true`.
      validado: true,
    };
    if (store) {
      Object.assign(store, poblado);
    } else {
      tenantContext.enterWith(poblado);
    }
    req.tenantId = tenantId;
    return true;
  }
}
