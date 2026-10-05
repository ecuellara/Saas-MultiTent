import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { tenantContext } from './tenant-context.js';

/**
 * Crea el scope del `TenantContext` para TODA la petición (ADR-003).
 *
 * El middleware corre antes que los guards y envuelve el `next()` con
 * `tenantContext.run(...)`, de modo que guards, interceptores, pipes y
 * handlers comparten el MISMO objeto de store. `TenantGuard` lo puebla
 * (ahí `req.user` ya existe) mutándolo in place.
 *
 * Por qué no basta `enterWith` en el guard: `enterWith` fija el store en
 * el subcontexto async del propio guard; los hops hermanos (siguiente
 * guard, handler) no lo heredan — ALS solo hereda de padre a hijo.
 * Con `run()` en el middleware, todos descienden del mismo scope.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers['x-tenant-id'] ?? req.headers['X-Tenant-Id'];
    const declarado = Array.isArray(header) ? header[0] : header;
    tenantContext.run(
      {
        tenantId: typeof declarado === 'string' ? declarado : '',
        userId: '',
        roleIds: [],
        permissions: [],
        sedeId: undefined,
      },
      () => next(),
    );
  }
}
