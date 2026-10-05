import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  tenantId: string;
  userId: string;
  roleIds: string[];
  permissions: string[];
  sedeId?: string;
  /**
   * `true` solo cuando TenantGuard ha validado tenant + membresía.
   * El middleware siembra la cabecera SIN validar; la extensión Prisma solo
   * filtra con contexto validado (ver tenant-extension.ts).
   */
  validado: boolean;
}

export const tenantContext = new AsyncLocalStorage<TenantStore>();

export function requireTenant(): TenantStore {
  const ctx = tenantContext.getStore();
  if (!ctx?.validado || !ctx.tenantId) {
    throw new Error('TenantContext no disponible');
  }
  return ctx;
}

export function currentTenantId(): string {
  return requireTenant().tenantId;
}
